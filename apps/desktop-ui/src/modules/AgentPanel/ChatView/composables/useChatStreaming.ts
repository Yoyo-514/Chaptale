import { ref, type Ref } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSessionStore } from '@/stores/session';
import { getDesktopApi, toErrorMessage } from '@/stores/utils/desktop-api';
import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { createDisplayMessage, createUserMessage } from '../utils/message/display-message';
import {
  getAssistantReasoning,
  getAssistantText,
  getAssistantToolCalls,
  hasRenderableMessage
} from '../utils/message/message-content';
import type { ChatState } from './chat-state';
import type { useAssistantStreamingMessages } from './useAssistantStreamingMessages';

export type RunQueryOptions = {
  appendUser: boolean;
  branchFromEntryId?: string | null;
  reuseUserEntryId?: string;
};

type UseChatStreamingOptions = {
  state: ChatState;
  assistantStreaming: ReturnType<typeof useAssistantStreamingMessages>;
  currentLeafId: Ref<string | null>;
  loadCurrentSessionMessages: () => Promise<void>;
  getDesktopApiOrNotify: () => ChaptaleDesktopApi | undefined;
};

/**
 * 协调单次 Agent 运行的乐观用户消息、Preload 事件流、终态回载与取消。
 * 流式消息先更新视图投影，done 后再从持久化会话重载，最终以主进程落盘结果为准。
 */
export function useChatStreaming({
  state,
  assistantStreaming,
  currentLeafId,
  loadCurrentSessionMessages,
  getDesktopApiOrNotify
}: UseChatStreamingOptions) {
  const sessionStore = useSessionStore();
  const notificationStore = useNotificationStore();
  const activeRunId = ref<string>('');

  function finishRun() {
    assistantStreaming.finishMessages();
    activeRunId.value = '';
    state.isReplying = false;
    state.isConnecting = false;
  }

  /** 中断当前流；用于回复中再次点击发送按钮。 */
  async function cancelActiveRun() {
    const runId = activeRunId.value;
    finishRun();

    if (runId) {
      await getDesktopApiOrNotify()?.agent.cancel(runId);
    }
  }

  async function runQuery(query: string, options: RunQueryOptions) {
    try {
      state.isConnecting = true;
      // 清空输入状态前先复制本轮附件，确保异步建会话期间用户界面与提交 payload 使用同一快照。
      const submittedContextFiles = options.appendUser ? state.contextFiles.map(file => ({ ...file })) : [];
      const contextFilePaths = submittedContextFiles.map(file => file.path);

      if (options.appendUser) {
        state.messages.push(createDisplayMessage(createUserMessage(query, submittedContextFiles)));
      }

      state.input = '';
      state.editingMessageId = '';
      state.contextFiles = [];
      state.isReplying = true;
      assistantStreaming.ensureStreamingAssistant();

      const desktopApi = getDesktopApi();
      const sessionId = await sessionStore.ensureActiveSession();

      const { runId } = await desktopApi.agent.stream(
        query,
        {
          onMessage: message => {
            if (message.role === 'user') {
              const userMessage = state.messages.findLast(item => item.message.role === 'user');

              if (userMessage) {
                userMessage.message = message;
              }
              return;
            }

            if (message.role === 'assistant' && message.partial) {
              if (getAssistantToolCalls(message).length > 0) {
                assistantStreaming.flush();
                assistantStreaming.appendOrReplaceAssistantMessage({
                  ...message,
                  partial: false,
                  stopReason: message.stopReason ?? 'toolUse'
                });
                return;
              }

              if (message.content.length === 0 && getAssistantReasoning(message)) {
                assistantStreaming.flush();
                assistantStreaming.updateReasoningStatus('streaming');
                return;
              }

              const reasoning = getAssistantReasoning(message);
              const content = getAssistantText(message);

              if (reasoning && !content) {
                assistantStreaming.pushReasoning(reasoning);
              } else if (content) {
                assistantStreaming.pushText(content);
              }

              return;
            }

            assistantStreaming.flush();

            if (hasRenderableMessage(message)) {
              assistantStreaming.appendOrReplaceAssistantMessage(message);
            }
          },
          onDone: () => {
            finishRun();
            // 终态后清除乐观叶子并重读磁盘树，补齐 entryId、分支和用量等流式事件不携带的信息。
            currentLeafId.value = null;
            void sessionStore.loadSessions().then(loadCurrentSessionMessages);
          },
          onError: message => {
            finishRun();
            assistantStreaming.appendErrorMessage(message);
            notificationStore.error('AI 回复失败', message);
          }
        },
        sessionId,
        {
          branchFromEntryId: options.branchFromEntryId,
          contextFilePaths,
          reuseUserEntryId: options.reuseUserEntryId
        }
      );

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      const message = toErrorMessage(error);
      finishRun();
      assistantStreaming.appendErrorMessage(message);
      notificationStore.error('发送失败', message);
    }
  }

  return { activeRunId, runQuery, cancelActiveRun };
}
