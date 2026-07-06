import { computed, onMounted, reactive, ref, watch } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import { useNotificationStore } from '../../../stores/notification';
import { useSessionStore } from '../../../stores/session';
import { useSettingsStore } from '../../../stores/settings';
import type { ChatDisplayMessage } from '../types';
import { buildDisplayMessagesFromEntries } from '../utils/message/branching';
import {
  getAssistantReasoning,
  getAssistantText,
  getPrimaryToolCall,
  getUserText,
  hasRenderableMessage
} from '../utils/message/message-content';
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

function createDisplayMessage(message: ChatMessage, prefix = 'message'): ChatDisplayMessage {
  messageSequence += 1;

  return {
    id: `${prefix}-${Date.now()}-${messageSequence}`,
    message
  };
}

function createUserMessage(content: string): ChatMessage {
  return {
    role: 'user',
    content,
    timestamp: Date.now()
  };
}

function createAssistantErrorMessage(message: string): ChatMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now()
  };
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

function hasAssistantPayload(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return Boolean(
    message.errorMessage?.trim() ||
    message.retry ||
    getAssistantText(message).trim() ||
    getAssistantReasoning(message).trim() ||
    getPrimaryToolCall(message)
  );
}

export function useChatController() {
  const sessionStore = useSessionStore();
  const settingsStore = useSettingsStore();
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

  async function loadWebAccessSettings() {
    if (!settingsStore.state) {
      await settingsStore.load();
    }

    const webSearchEnabled = settingsStore.state?.settings.webAccess.webSearchEnabled;

    if (typeof webSearchEnabled === 'boolean') {
      state.isEnabledWebSearch = webSearchEnabled;
    }
  }

  onMounted(() => {
    void loadCurrentSessionMessages();
    void loadWebAccessSettings();
  });

  watch(
    () => settingsStore.state?.settings.webAccess.webSearchEnabled,
    webSearchEnabled => {
      if (typeof webSearchEnabled === 'boolean') {
        state.isEnabledWebSearch = webSearchEnabled;
      }
    }
  );

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

  function getStreamingAssistant() {
    const lastMessage = state.messages.at(-1)?.message;

    return lastMessage?.role === 'assistant' && lastMessage.partial ? lastMessage : undefined;
  }

  function ensureStreamingAssistant() {
    const streamingAssistant = getStreamingAssistant();

    if (streamingAssistant) {
      return streamingAssistant;
    }

    const message: ChatMessage = {
      role: 'assistant',
      partial: true,
      content: [],
      timestamp: Date.now()
    };
    state.messages.push(createDisplayMessage(message));
    return message;
  }

  function updateAssistantReasoningStatus(status: 'streaming' | 'done') {
    const message = ensureStreamingAssistant();

    if (status === 'done') {
      message.partial = false;
    }
  }

  function appendAssistantDelta(delta: string, target: 'content' | 'reasoning') {
    const message = ensureStreamingAssistant();

    if (target === 'reasoning') {
      const lastBlock = message.content.at(-1);

      if (lastBlock?.type === 'thinking') {
        lastBlock.thinking += delta;
      } else {
        message.content.push({ type: 'thinking', thinking: delta, thinkingSignature: 'reasoning_content' });
      }

      return;
    }

    const lastBlock = message.content.at(-1);

    if (lastBlock?.type === 'text') {
      lastBlock.text += delta;
    } else {
      message.content.push({ type: 'text', text: delta });
    }
  }

  function markStreamingAssistantComplete() {
    const lastMessage = getStreamingAssistant();

    if (lastMessage) {
      lastMessage.partial = false;
    }
  }

  function removeEmptyStreamingAssistant() {
    const lastDisplayMessage = state.messages.at(-1);
    const lastMessage = lastDisplayMessage?.message;

    if (lastMessage?.role === 'assistant' && lastMessage.partial && !hasAssistantPayload(lastMessage)) {
      state.messages.pop();
    }
  }

  function appendOrReplaceAssistantMessage(message: ChatMessage) {
    if (message.role !== 'assistant') {
      state.messages.push(createDisplayMessage(message));
      return;
    }

    const lastDisplayMessage = state.messages.at(-1);
    const lastMessage = lastDisplayMessage?.message;

    if (lastMessage?.role === 'assistant' && lastMessage.partial) {
      state.messages.splice(state.messages.length - 1, 1, createDisplayMessage(message));
      return;
    }

    state.messages.push(createDisplayMessage(message));
  }

  function appendErrorMessage(message: string) {
    removeEmptyStreamingAssistant();
    state.messages.push(createDisplayMessage(createAssistantErrorMessage(message), 'error'));
  }

  function finishRun() {
    flushStreamingBuffers();
    removeEmptyStreamingAssistant();
    markStreamingAssistantComplete();
    activeRunId.value = '';
    state.isReplying = false;
    state.isConnecting = false;
  }

  async function runQuery(query: string, options: { appendUser: boolean; branchFromEntryId?: string | null }) {
    try {
      state.isConnecting = true;

      if (options.appendUser) {
        state.messages.push(createDisplayMessage(createUserMessage(query)));
      }

      state.input = '';
      state.editingMessageId = '';
      state.isReplying = true;
      ensureStreamingAssistant();

      if (!window.chaptaleDesktop) {
        throw new Error('当前界面需要在 Chaptale 桌面端中运行');
      }

      const sessionId = await sessionStore.ensureActiveSession();

      const { runId } = await window.chaptaleDesktop.agent.stream(
        query,
        {
          onMessage: message => {
            if (message.role === 'assistant' && message.partial) {
              if (message.content.length === 0 && getAssistantReasoning(message)) {
                flushStreamingBuffers();
                updateAssistantReasoningStatus('streaming');
                return;
              }

              const reasoning = getAssistantReasoning(message);
              const content = getAssistantText(message);

              if (reasoning && !content) {
                streamingReasoningBuffer.push(reasoning);
              } else if (content) {
                streamingTextBuffer.push(content);
              }

              return;
            }

            flushStreamingBuffers();

            if (hasRenderableMessage(message)) {
              appendOrReplaceAssistantMessage(message);
            }
          },
          onDone: () => {
            finishRun();
            currentLeafId.value = null;
            void sessionStore.loadSessions().then(loadCurrentSessionMessages);
          },
          onError: message => {
            finishRun();
            appendErrorMessage(message);
            notificationStore.error('AI 回复失败', message);
          }
        },
        sessionId,
        { branchFromEntryId: options.branchFromEntryId }
      );

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishRun();
      appendErrorMessage(message);
      notificationStore.error('发送失败', message);
    }
  }

  async function handleSend() {
    // 正在回复时再次点击按钮则中断流。必须优先于 isConnecting 判断，
    // 因为模型重试等待期间可能同时处于 connecting/replying 状态。
    if (state.isReplying) {
      const runId = activeRunId.value;
      finishRun();

      if (runId) {
        await window.chaptaleDesktop?.agent.cancel(runId);
      }
      return;
    }

    if (state.isConnecting) return;

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

    if (!displayMessage || displayMessage.message.role !== 'user') {
      return;
    }

    displayMessage.message.content = content;
    markUserMessageAsOptimisticBranch(displayMessage);
    state.messages.splice(messageIndex + 1);
    await runQuery(content, { appendUser: false, branchFromEntryId: displayMessage.parentEntryId ?? null });
  }

  async function handleToggleWebSearch() {
    const previousValue = state.isEnabledWebSearch;
    const nextValue = !previousValue;
    state.isEnabledWebSearch = nextValue;

    if (!settingsStore.state) {
      await settingsStore.load();
    }

    await settingsStore.update({ webAccess: { webSearchEnabled: nextValue } });

    if (settingsStore.error) {
      state.isEnabledWebSearch = previousValue;
    }
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
      .find(displayMessage => displayMessage.message.role === 'user');

    if (!userMessage || userMessage.message.role !== 'user') {
      return;
    }

    const userIndex = state.messages.findIndex(displayMessage => displayMessage.id === userMessage.id);

    if (userIndex === -1) {
      return;
    }

    state.messages.splice(userIndex + 1);
    await runQuery(getUserText(userMessage.message), {
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
    handleToggleWebSearch,
    handleSwitchBranch
  };
}
