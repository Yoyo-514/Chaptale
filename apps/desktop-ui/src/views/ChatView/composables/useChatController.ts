import { computed, onMounted, reactive, ref, watch } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import { useNotificationStore } from '../../../stores/notification';
import { useSessionStore } from '../../../stores/session';
import type { ChatDisplayMessage } from '../types';
import { buildDisplayMessagesFromEntries } from '../utils/message/branching';
import { hasRenderableMessage } from '../utils/message/message-content';
import { useStreamingMessageBuffer } from './useStreamingMessageBuffer';

type ChatState = {
  messages: ChatDisplayMessage[];
  input: string;
  editingMessageId: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
  isLoadingMessages: boolean;
};

let messageSequence = 0;

function createDisplayMessage(
  message: ChatMessage,
  prefix = 'message',
  options: Pick<ChatDisplayMessage, 'variant'> = {}
): ChatDisplayMessage {
  messageSequence += 1;

  return {
    id: `${prefix}-${Date.now()}-${messageSequence}`,
    message,
    ...options
  };
}

function hasTextPayload(message: ChatMessage): message is Extract<ChatMessage, { payload: { content: string } }> {
  return 'content' in message.payload;
}

function markUserMessageAsOptimisticBranch(displayMessage: ChatDisplayMessage) {
  const total = (displayMessage.branch?.total ?? 1) + 1;

  displayMessage.branch = {
    current: total,
    total,
    previousLeafId: displayMessage.branch?.previousLeafId,
    nextLeafId: undefined
  };
}

export function useChatController() {
  const sessionStore = useSessionStore();
  const notificationStore = useNotificationStore();
  const state = reactive<ChatState>({
    messages: [],
    input: '',
    editingMessageId: '',
    isConnecting: false,
    isReplying: false,
    isEnabledWebSearch: true,
    isLoadingMessages: true
  });

  const activeRunId = ref<string>('');
  const currentLeafId = ref<string | null>(null);
  let loadMessagesSequence = 0;
  const isWelcome = computed(() => !state.isLoadingMessages && state.messages.length === 0);
  const recentSessions = computed(() =>
    sessionStore.sessions
      .filter(session => session.id !== sessionStore.currentSessionId)
      .filter(session => session.messageCount > 0 || session.lastMessagePreview || session.name)
      .slice(0, 2)
  );

  const streamingTextBuffer = useStreamingMessageBuffer(delta => {
    appendAssistantDelta(delta, 'content');
  });
  const streamingReasoningBuffer = useStreamingMessageBuffer(delta => {
    appendAssistantDelta(delta, 'reasoning');
  });

  async function handleSelectRecentSession(sessionId: string) {
    currentLeafId.value = null;
    await sessionStore.selectSession(sessionId);
  }

  async function loadCurrentSessionMessages() {
    const sequence = (loadMessagesSequence += 1);
    state.isLoadingMessages = true;
    resetStreamingBuffers();

    try {
      if (!window.chaptaleDesktop) {
        notificationStore.error('当前界面需要在 Chaptale 桌面端中运行');
        return;
      }

      const entries = await sessionStore.getCurrentEntries().catch(error => {
        notificationStore.error('读取会话消息失败', error instanceof Error ? error.message : String(error));
        return [];
      });

      if (sequence !== loadMessagesSequence) {
        return;
      }

      currentLeafId.value = currentLeafId.value ?? sessionStore.currentSession?.leafId ?? entries.at(-1)?.id ?? null;
      state.messages = buildDisplayMessagesFromEntries(entries, currentLeafId.value);
    } finally {
      if (sequence === loadMessagesSequence) {
        state.isLoadingMessages = false;
      }
    }
  }

  onMounted(loadCurrentSessionMessages);

  watch(
    () => sessionStore.currentSessionId,
    async (sessionId, previousSessionId) => {
      if (!sessionId || sessionId === previousSessionId) {
        return;
      }

      currentLeafId.value = null;
      await loadCurrentSessionMessages();
    }
  );

  function flushStreamingBuffers() {
    streamingReasoningBuffer.flushNow();
    streamingTextBuffer.flushNow();
  }

  function resetStreamingBuffers() {
    streamingReasoningBuffer.reset();
    streamingTextBuffer.reset();
  }

  function updateAssistantReasoningStatus(status: 'streaming' | 'done') {
    const lastMessage = state.messages.at(-1)?.message;

    if (lastMessage?.type === 'assistant' && lastMessage.partial && hasTextPayload(lastMessage)) {
      lastMessage.payload.reasoningStatus = status;
      return;
    }

    state.messages.push(
      createDisplayMessage({
        type: 'assistant',
        partial: true,
        payload: { content: '', reasoningStatus: status }
      })
    );
  }

  function appendAssistantDelta(delta: string, target: 'content' | 'reasoning') {
    const lastMessage = state.messages.at(-1)?.message;

    if (lastMessage?.type === 'assistant' && lastMessage.partial && hasTextPayload(lastMessage)) {
      if (target === 'reasoning') {
        lastMessage.payload.reasoning = `${lastMessage.payload.reasoning ?? ''}${delta}`;
        lastMessage.payload.reasoningStatus = 'streaming';
      } else {
        lastMessage.payload.content += delta;
      }

      return;
    }

    state.messages.push(
      createDisplayMessage({
        type: 'assistant',
        partial: true,
        payload:
          target === 'reasoning' ? { content: '', reasoning: delta, reasoningStatus: 'streaming' } : { content: delta }
      })
    );
  }

  function markStreamingAssistantComplete() {
    const lastMessage = state.messages.at(-1)?.message;

    if (lastMessage?.type === 'assistant' && lastMessage.partial) {
      if (lastMessage.payload.reasoningStatus === 'streaming') {
        lastMessage.payload.reasoningStatus = 'done';
      }

      lastMessage.partial = false;
    }
  }

  function appendErrorMessage(message: string) {
    state.messages = [
      ...state.messages,
      createDisplayMessage(
        {
          type: 'system',
          payload: { content: message }
        },
        'error',
        { variant: 'error' }
      )
    ];
  }

  async function runQuery(query: string, options: { appendUser: boolean; branchFromEntryId?: string | null }) {
    try {
      state.isConnecting = true;

      if (!window.chaptaleDesktop) {
        throw new Error('当前界面需要在 Chaptale 桌面端中运行');
      }

      const sessionId = await sessionStore.ensureActiveSession();

      if (options.appendUser) {
        state.messages.push(
          createDisplayMessage({
            type: 'user',
            payload: {
              content: query
            }
          })
        );
      }

      state.input = '';
      state.editingMessageId = '';
      state.isReplying = true;

      const { runId } = await window.chaptaleDesktop.agent.stream(
        query,
        {
          onMessage: message => {
            if (message.type === 'assistant' && message.partial) {
              if (message.payload.reasoningStatus && !message.payload.reasoning && !message.payload.content) {
                flushStreamingBuffers();
                updateAssistantReasoningStatus(message.payload.reasoningStatus);
                return;
              }

              if (message.payload.reasoning && !message.payload.content) {
                streamingReasoningBuffer.push(message.payload.reasoning);
              } else {
                streamingTextBuffer.push(message.payload.content);
              }

              return;
            }

            flushStreamingBuffers();

            if (hasRenderableMessage(message)) {
              state.messages.push(createDisplayMessage(message));
            }
          },
          onDone: () => {
            flushStreamingBuffers();
            markStreamingAssistantComplete();
            activeRunId.value = '';
            currentLeafId.value = null;
            state.isReplying = false;
            state.isConnecting = false;
            void sessionStore.loadSessions().then(loadCurrentSessionMessages);
          },
          onError: message => {
            flushStreamingBuffers();
            markStreamingAssistantComplete();
            activeRunId.value = '';
            appendErrorMessage(message);
            notificationStore.error('AI 回复失败', message);
            state.isReplying = false;
            state.isConnecting = false;
          }
        },
        sessionId,
        { branchFromEntryId: options.branchFromEntryId }
      );

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      flushStreamingBuffers();
      markStreamingAssistantComplete();
      appendErrorMessage(message);
      notificationStore.error('发送失败', message);
      state.isReplying = false;
      state.isConnecting = false;
    }
  }

  async function handleSend() {
    if (state.isConnecting) return;

    // 正在回复时再次点击按钮则中断流
    if (state.isReplying) {
      if (activeRunId.value) {
        await window.chaptaleDesktop?.agent.cancel(activeRunId.value);
      }
      return;
    }

    const query = state.input.trim();

    if (!query) {
      return;
    }

    await runQuery(query, { appendUser: true });
  }

  function handleEditUserMessage(messageId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    state.editingMessageId = messageId;
  }

  function handleCancelEdit() {
    state.editingMessageId = '';
  }

  async function handleSaveUserMessage(messageId: string, content: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const messageIndex = state.messages.findIndex(displayMessage => displayMessage.id === messageId);
    const displayMessage = state.messages[messageIndex];

    if (!displayMessage || displayMessage.message.type !== 'user') {
      return;
    }

    displayMessage.message.payload.content = content;
    markUserMessageAsOptimisticBranch(displayMessage);
    state.messages.splice(messageIndex + 1);
    await runQuery(content, { appendUser: false, branchFromEntryId: displayMessage.parentEntryId ?? null });
  }

  async function handleSwitchBranch(leafId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    currentLeafId.value = leafId;
    await sessionStore.setCurrentLeaf(leafId);
    await loadCurrentSessionMessages();
  }

  async function handleRegenerateAssistantMessage(messageId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const assistantIndex = state.messages.findIndex(displayMessage => displayMessage.id === messageId);

    if (assistantIndex === -1) {
      return;
    }

    const userMessage = [...state.messages]
      .slice(0, assistantIndex)
      .reverse()
      .find(displayMessage => displayMessage.message.type === 'user');

    if (!userMessage || userMessage.message.type !== 'user') {
      return;
    }

    const userIndex = state.messages.findIndex(displayMessage => displayMessage.id === userMessage.id);

    if (userIndex === -1) {
      return;
    }

    state.messages.splice(userIndex + 1);
    await runQuery(userMessage.message.payload.content, {
      appendUser: false,
      branchFromEntryId: userMessage.parentEntryId ?? null
    });
  }

  return {
    state,
    isWelcome,
    recentSessions,
    handleSelectRecentSession,
    handleSend,
    handleEditUserMessage,
    handleSaveUserMessage,
    handleCancelEdit,
    handleRegenerateAssistantMessage,
    handleSwitchBranch
  };
}
