import { ref, type Ref } from 'vue';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import {
  getAssistantReasoning,
  getAssistantText,
  getAssistantToolCalls,
  hasRenderableMessage
} from '../utils/message/message-content';
import type { ChatState } from './chat-state';
import type { useAssistantStreamingMessages } from './useAssistantStreamingMessages';
import { usePendingUserMessages } from './usePendingUserMessages';

/** 普通 Agent 运行可选的乐观消息和分支参数。 */
export type RunQueryOptions = {
  appendUser: boolean;
  branchFromEntryId?: string | null;
  reuseUserEntryId?: string;
};

/** Chat 流式协调器依赖的视图状态与会话操作。 */
type UseChatStreamingOptions = {
  state: ChatState;
  assistantStreaming: ReturnType<typeof useAssistantStreamingMessages>;
  currentLeafId: Ref<string | null>;
  loadCurrentSessionMessages: () => Promise<void>;
  getDesktopApiOrNotify: () => ChaptaleDesktopApi | undefined;
};

/** 按路径去重上下文文件，并保持第一次出现的顺序。 */
function dedupeContextFiles(files: ChatContextFile[]): ChatContextFile[] {
  const seen = new Set<string>();
  return files.filter(file => {
    if (seen.has(file.path)) {
      return false;
    }

    seen.add(file.path);
    return true;
  });
}

/**
 * 协调单次 Agent 运行的乐观用户消息、Preload 事件流、steer 队列、终态回载与取消。
 * 流式消息先更新视图投影，唯一 end 终态后再从持久化会话重载，最终以主进程落盘结果为准。
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
  const pendingUsers = usePendingUserMessages(state);
  // 运行代次：每次启动新运行递增，终态收束后再递增；旧代次的迟到事件一律丢弃。
  let runEpoch = 0;
  // start IPC 尚未返回时保留本代 runId promise，空输入取消会等待它而不是静默假成功。
  let pendingRun: { epoch: number; runId: Promise<string> } | null = null;
  // 仍在进行的终态回载；新运行必须等它完成，避免旧回载覆盖新运行的乐观消息。
  let pendingTerminalReload: Promise<void> | null = null;

  /** 收束当前运行的流式状态和临时用户消息队列，并作废旧代次的迟到事件。 */
  function finishRun(): void {
    runEpoch += 1;
    assistantStreaming.finishMessages();
    pendingUsers.clear();
    activeRunId.value = '';
    pendingRun = null;
    state.isReplying = false;
    state.isConnecting = false;
    state.isCancelling = false;
    state.isSubmittingSteer = false;
  }

  /** 登记终态回载，完成后自动释放，供下一次运行启动前等待。 */
  function trackTerminalReload(reload: Promise<void>): void {
    const tracked = reload.finally(() => {
      if (pendingTerminalReload === tracked) {
        pendingTerminalReload = null;
      }
    });
    pendingTerminalReload = tracked;
  }

  /** 终态后重读持久化会话，清除只存在于 Renderer 的乐观投影。 */
  async function reloadPersistedSession(): Promise<void> {
    currentLeafId.value = null;
    await sessionStore.loadSessions();
    await loadCurrentSessionMessages();
  }

  /**
   * 中断当前流；取消 IPC 成功只代表请求已受理，运行必须等待唯一 end 终态才能收束。
   * 请求失败时保留 runId 与生成状态，避免把网络/进程错误伪装成取消成功。
   */
  async function cancelActiveRun(): Promise<void> {
    const epoch = runEpoch;
    const activeId = activeRunId.value;
    const startingId = pendingRun?.epoch === epoch ? pendingRun.runId : null;

    if ((!activeId && !startingId) || state.isCancelling) {
      return;
    }

    state.isCancelling = true;
    const desktopApi = getDesktopApiOrNotify();

    if (!desktopApi) {
      state.isCancelling = false;
      return;
    }

    try {
      const runId = activeId || (await startingId!);

      // start 等待期间可能失败或已收到同步终态；旧代次不得再补发取消或复活状态。
      if (!runId || epoch !== runEpoch) {
        return;
      }

      await desktopApi.agent.cancel(runId);
    } catch (error) {
      // 仅回滚仍属于本 run 的 cancelling；若终态已先到，不能复活已结束运行。
      if (epoch !== runEpoch) {
        return;
      }

      state.isCancelling = false;
      notificationStore.error('取消失败', toErrorMessage(error));
    }
  }

  /** 提交一条 steer；调用失败时保留原草稿并回滚临时消息。 */
  async function steer(query: string): Promise<void> {
    const runId = activeRunId.value;

    if (!runId || state.isSubmittingSteer) {
      return;
    }

    const contextFiles = state.contextFiles.map(file => ({ ...file }));
    const pending = pendingUsers.enqueue('steer', query, contextFiles);
    state.isSubmittingSteer = true;

    try {
      await getDesktopApi().agent.steer(runId, query, {
        contextFilePaths: contextFiles.map(file => file.path)
      });
      pendingUsers.markQueued(pending.id);
      state.input = '';
      state.contextFiles = [];
    } catch (error) {
      pendingUsers.rollback(pending.id);
      notificationStore.error('发送调整失败', toErrorMessage(error));
    } finally {
      state.isSubmittingSteer = false;
    }
  }

  /** 清空 SDK 队列，并把实际未消费的本地 steer 恢复到编辑器。 */
  async function restorePendingMessages(): Promise<void> {
    const runId = activeRunId.value;

    if (!runId || state.isSubmittingSteer) {
      return;
    }

    try {
      const result = await getDesktopApi().agent.clearPendingMessages(runId);
      const restored = pendingUsers.takeQueuedSteersFromTail(result.queue.steering.length);
      const localTexts = restored.map(item => item.query);
      const missingCount = Math.max(0, result.queue.steering.length - restored.length);
      const missingSdkTexts = result.queue.steering.slice(0, missingCount);
      const queuedText = [...missingSdkTexts, ...localTexts, ...result.queue.followUp].join('\n\n');

      state.input = [queuedText, state.input].filter(text => text.trim()).join('\n\n');
      state.contextFiles = dedupeContextFiles([...restored.flatMap(item => item.contextFiles), ...state.contextFiles]);
    } catch (error) {
      notificationStore.error('恢复待处理消息失败', toErrorMessage(error));
    }
  }

  /** 启动普通 prompt，并把同一条事件流投影到当前 ChatView。 */
  async function runQuery(query: string, options: RunQueryOptions): Promise<void> {
    // 上一轮终态回载尚未完成时先等待，确保它不会覆盖本轮即将追加的乐观消息。
    if (pendingTerminalReload) {
      await pendingTerminalReload.catch(() => undefined);
    }

    const epoch = (runEpoch += 1);

    try {
      state.isConnecting = true;
      // 清空输入状态前先复制本轮附件，确保异步建会话期间界面与 payload 使用同一快照。
      const submittedContextFiles = options.appendUser ? state.contextFiles.map(file => ({ ...file })) : [];
      const contextFilePaths = submittedContextFiles.map(file => file.path);

      if (options.appendUser) {
        pendingUsers.enqueue('prompt', query, submittedContextFiles);
      }

      state.input = '';
      state.editingMessageId = '';
      state.contextFiles = [];

      const desktopApi = getDesktopApi();
      const sessionId = await sessionStore.ensureActiveSession();
      state.isReplying = true;
      assistantStreaming.ensureStreamingAssistant();

      const streamResult = desktopApi.agent.stream(
        query,
        {
          onMessage: message => {
            // 取消或新运行启动后，旧运行的迟到消息不得再投影到视图。
            if (epoch !== runEpoch) {
              return;
            }

            if (message.role === 'user') {
              // 普通 prompt 与连续 steer 共用 FIFO；无记录时兼容分支编辑产生的 user event。
              if (!pendingUsers.resolveNext(message)) {
                const userMessage = state.messages.findLast(item => item.message.role === 'user');
                if (userMessage) {
                  userMessage.message = message;
                }
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

              if (message.content !== undefined && message.content === '' && getAssistantReasoning(message)) {
                assistantStreaming.flush();
                // partial 快照：累计 reasoning 直接替换（part-translator 发的是全量而非增量）。
                assistantStreaming.replaceReasoning(getAssistantReasoning(message));
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
          onEnd: end => {
            if (epoch !== runEpoch) {
              return;
            }

            finishRun();

            if (end.status === 'failed') {
              notificationStore.error('AI 回复失败', end.message);
              // 先清除未持久化的乐观投影，再追加错误消息，避免失败的 steer 看起来像已交付。
              trackTerminalReload(
                reloadPersistedSession()
                  .catch(() => undefined)
                  .then(() => assistantStreaming.appendErrorMessage(end.message))
              );
              return;
            }

            // completed/cancelled 都以 Main 持久化结果为准，取消请求本身绝不提前回载。
            trackTerminalReload(reloadPersistedSession().catch(() => undefined));
          }
        },
        sessionId,
        {
          branchFromEntryId: options.branchFromEntryId,
          contextFilePaths,
          reuseUserEntryId: options.reuseUserEntryId
        }
      );
      pendingRun = {
        epoch,
        // 启动失败由 runQuery 统一通知；这里只把等待取消的 runId 收敛为空，避免派生 Promise 无人处理拒绝。
        runId: streamResult.then(
          result => result.runId,
          () => ''
        )
      };
      const { runId } = await streamResult;

      if (pendingRun?.epoch === epoch) {
        pendingRun = null;
      }

      // stream() 内部同步报错时本轮已收束，不能再把已终态的 runId 登记为活跃运行。
      if (epoch !== runEpoch) {
        return;
      }

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      if (pendingRun?.epoch === epoch) {
        pendingRun = null;
      }

      if (epoch !== runEpoch) {
        return;
      }

      const message = toErrorMessage(error);
      finishRun();
      assistantStreaming.appendErrorMessage(message);
      notificationStore.error('发送失败', message);
    }
  }

  return { activeRunId, runQuery, steer, restorePendingMessages, cancelActiveRun };
}
