import { computed, onMounted, reactive, ref, watch } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { getDesktopApi } from '@/stores/utils/desktop-api';
import type { SelectedContextFile } from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';
import { errorToMessage } from '@chaptale/shared';
import type { ChatDisplayMessage } from '../types';
import { getDroppedContextFilePaths, mergeSelectedContextFiles } from '../utils/context-files';
import { buildDisplayMessagesFromEntries } from '../utils/message/branching';
import {
  getAssistantReasoning,
  getAssistantText,
  getUserText,
  hasRenderableMessage
} from '../utils/message/message-content';
import { useAssistantStreamingMessages } from './useAssistantStreamingMessages';

type ChatState = {
  messages: ChatDisplayMessage[];
  input: string;
  editingMessageId: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
  isLoadingMessages: boolean;
  contextFiles: SelectedContextFile[];
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
  const settingsStore = useSettingsStore();
  const notificationStore = useNotificationStore();
  const state = reactive<ChatState>({
    messages: [],
    input: '',
    editingMessageId: '',
    isConnecting: false,
    isReplying: false,
    isEnabledWebSearch: true,
    isLoadingMessages: true,
    contextFiles: []
  });

  const activeRunId = ref<string>('');
  const currentLeafId = ref<string | null>(null);
  let loadMessagesSequence = 0;
  const isWelcome = computed(() => !state.isLoadingMessages && state.messages.length === 0);
  const currentModelLabel = computed(() => {
    // 默认模型持久化在 pi settingsManager（models.setDefault），所以这里必须读 models 列表的 defaultModel。
    const defaultModel = settingsStore.models?.defaultModel;

    if (defaultModel) {
      return `${defaultModel.provider} / ${defaultModel.modelId}`;
    }

    return settingsStore.isModelsLoading ? '读取模型中' : '未选择模型';
  });
  const workspaceLabel = computed(() => {
    const storage = settingsStore.state?.settings.storage;

    if (!storage) {
      return '读取工作区中';
    }

    if (storage.mode === 'workspace') {
      return storage.workspacePath ? `工作区：${storage.workspacePath}` : '未选择工作区';
    }

    return '全局会话';
  });
  const recentSessions = computed(() =>
    sessionStore.sessions
      .filter(session => session.id !== sessionStore.currentSessionId)
      .filter(session => session.messageCount > 0 || session.lastMessagePreview || session.name)
      .slice(0, 2)
  );

  const assistantStreaming = useAssistantStreamingMessages({
    getMessages: () => state.messages,
    createDisplayMessage
  });

  async function handleSelectRecentSession(sessionId: string) {
    currentLeafId.value = null;
    await sessionStore.selectSession(sessionId);
  }

  async function loadCurrentSessionMessages() {
    const sequence = (loadMessagesSequence += 1);
    state.isLoadingMessages = true;
    assistantStreaming.reset();

    try {
      if (!getDesktopApiOrNotify()) {
        return;
      }

      const entries = await sessionStore.getCurrentEntries().catch(error => {
        notificationStore.error('读取会话消息失败', errorToMessage(error));
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

    const webSearchEnabled = settingsStore.state?.webAccess.webSearchEnabled;

    if (typeof webSearchEnabled === 'boolean') {
      state.isEnabledWebSearch = webSearchEnabled;
    }
  }

  onMounted(() => {
    void loadCurrentSessionMessages();
    void loadWebAccessSettings();

    // 状态条需要默认模型信息；若设置面板未打开过，models 尚未加载。
    if (!settingsStore.models) {
      void settingsStore.loadModels();
    }
  });

  watch(
    () => settingsStore.state?.webAccess.webSearchEnabled,
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

  function getDesktopApiOrNotify() {
    try {
      return getDesktopApi();
    } catch {
      notificationStore.error('当前界面需要在 Chaptale 桌面端中运行');
      return undefined;
    }
  }

  function finishRun() {
    assistantStreaming.finishMessages();
    activeRunId.value = '';
    state.isReplying = false;
    state.isConnecting = false;
  }

  async function runQuery(query: string, options: { appendUser: boolean; branchFromEntryId?: string | null }) {
    try {
      state.isConnecting = true;
      const contextFilePaths = state.contextFiles.map(file => file.path);

      if (options.appendUser) {
        state.messages.push(createDisplayMessage(createUserMessage(query)));
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
            if (message.role === 'assistant' && message.partial) {
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
        { branchFromEntryId: options.branchFromEntryId, contextFilePaths }
      );

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      const message = errorToMessage(error);
      finishRun();
      assistantStreaming.appendErrorMessage(message);
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

  async function handleAddContextFiles() {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const desktopApi = getDesktopApiOrNotify();
    if (!desktopApi) {
      return;
    }

    const files = await desktopApi.agent.selectContextFiles();
    mergeContextFiles(files);
  }

  function mergeContextFiles(files: SelectedContextFile[]) {
    state.contextFiles = mergeSelectedContextFiles(state.contextFiles, files);
  }

  async function handleDropContextFiles(droppedFiles: File[]) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const desktopApi = getDesktopApiOrNotify();
    if (!desktopApi) {
      return;
    }

    // 沙盒 renderer 拿不到 File.path，由 preload 的 webUtils 转换后再交给主进程校验。
    const paths = getDroppedContextFilePaths(droppedFiles, file => desktopApi.agent.getPathForFile(file));

    if (paths.length === 0) {
      return;
    }

    const inspected = await desktopApi.agent.inspectContextFiles(paths);

    if (inspected.length === 0) {
      notificationStore.error('拖入的文件类型暂不支持', '目前支持常见文本/代码文件与 png/jpg/webp/gif 图片');
      return;
    }

    if (inspected.length < paths.length) {
      notificationStore.info('部分文件未添加', '不支持的文件类型已自动跳过');
    }

    mergeContextFiles(inspected);
  }

  function handleRemoveContextFile(path: string) {
    state.contextFiles = state.contextFiles.filter(file => file.path !== path);
  }

  function handleOpenSettings(section: 'workspace' | 'llm' = 'workspace') {
    settingsStore.openPanel(section);
  }

  async function handleToggleWebSearch() {
    const previousValue = state.isEnabledWebSearch;
    const nextValue = !previousValue;
    state.isEnabledWebSearch = nextValue;

    if (!settingsStore.state) {
      await settingsStore.load();
    }

    await settingsStore.updateWebAccess({ webSearchEnabled: nextValue });

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

    const userMessage = state.messages
      .slice(0, assistantIndex)
      .findLast(displayMessage => displayMessage.message.role === 'user');

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
    currentModelLabel,
    workspaceLabel,
    recentSessions,
    handleSelectRecentSession,
    handleSend,
    handleEditUserMessage,
    handleSaveUserMessage,
    handleCancelEdit,
    handleRegenerateAssistantMessage,
    handleAddContextFiles,
    handleDropContextFiles,
    handleRemoveContextFile,
    handleOpenSettings,
    handleToggleWebSearch,
    handleSwitchBranch
  };
}
