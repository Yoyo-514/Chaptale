import { computed, onMounted, reactive, ref, watch } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import { getDesktopApi } from '@/stores/utils/desktop-api';
import type { SlashCommand } from '@chaptale/ipc-contract';
import type { ChatContextFile, ChatImageAttachment, ChatMessage } from '@chaptale/shared';
import { errorToMessage } from '@chaptale/shared';
import type { ChatDisplayMessage } from '../types';
import { getDroppedContextFilePaths, mergeChatContextFiles } from '../utils/context-files';
import { buildDisplayMessagesFromEntries } from '../utils/message/branching';
import { findSlashCommand, getSlashCommandName, parseSkillSlashCommand } from '../utils/slash-commands';
import {
  getAssistantReasoning,
  getAssistantText,
  getAssistantToolCalls,
  getUserImages,
  getUserText,
  hasRenderableMessage,
  hasUserAttachments
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
  contextFiles: ChatContextFile[];
  slashCommands: SlashCommand[];
};

let messageSequence = 0;

function createDisplayMessage(message: ChatMessage, prefix = 'message'): ChatDisplayMessage {
  messageSequence += 1;

  return {
    id: `${prefix}-${Date.now()}-${messageSequence}`,
    message
  };
}

function getPreviewImage(file: ChatContextFile): ChatImageAttachment | undefined {
  if (file.kind !== 'image' || !file.previewDataUrl || !file.mimeType) {
    return undefined;
  }

  return {
    type: 'imageAttachment',
    id: `selected:${file.path}`,
    mimeType: file.mimeType,
    originalBytes: file.size,
    width: file.imageWidth ?? 0,
    height: file.imageHeight ?? 0,
    thumbnailDataUrl: file.previewDataUrl,
    source: { type: 'context-file', path: file.path }
  };
}

function createUserMessage(content: string, contextFiles: ChatContextFile[] = []): ChatMessage {
  const images: ChatImageAttachment[] = [];
  const displayFiles: ChatContextFile[] = [];
  const skillInvocation = parseSkillSlashCommand(content);
  const displayContent = skillInvocation?.arguments ?? content;

  for (const file of contextFiles) {
    const image = getPreviewImage(file);

    if (image) {
      images.push(image);
    } else {
      displayFiles.push(file);
    }
  }

  return {
    role: 'user',
    content:
      images.length > 0
        ? [...(displayContent ? [{ type: 'text' as const, text: displayContent }] : []), ...images]
        : displayContent,
    ...(displayFiles.length > 0 ? { contextFiles: displayFiles } : {}),
    ...(skillInvocation ? { skillInvocation } : {}),
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
    contextFiles: [],
    slashCommands: []
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

  async function loadSlashCommands() {
    try {
      state.slashCommands = await getDesktopApi().slashCommands.list();
    } catch (error) {
      notificationStore.error('加载命令失败', errorToMessage(error));
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
    void loadSlashCommands();

    // 状态条需要默认模型信息；若设置面板未打开过，models 尚未加载。
    if (!settingsStore.models) {
      void settingsStore.loadModels();
    }
  });

  watch(
    () => state.input,
    (input, previousInput) => {
      if (input.startsWith('/') && !previousInput.startsWith('/')) {
        void loadSlashCommands();
      }
    }
  );

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
      await Promise.all([loadCurrentSessionMessages(), loadSlashCommands()]);
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

  async function runQuery(
    query: string,
    options: { appendUser: boolean; branchFromEntryId?: string | null; reuseUserEntryId?: string }
  ) {
    try {
      state.isConnecting = true;
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
        await getDesktopApiOrNotify()?.agent.cancel(runId);
      }
      return;
    }

    if (state.isConnecting) return;

    const query = state.input.trim();

    if (!query) {
      return;
    }

    const slashCommandName = getSlashCommandName(query);
    let slashCommand = findSlashCommand(query, state.slashCommands);

    // /settings 是应用的基础恢复入口，不依赖异步命令列表成功加载。
    if (slashCommandName === 'settings') {
      state.input = '';
      settingsStore.openPanel();
      return;
    }

    if (slashCommandName && !slashCommand) {
      await loadSlashCommands();
      slashCommand = findSlashCommand(query, state.slashCommands);
    }

    if (slashCommandName && !slashCommand) {
      notificationStore.error(`未知命令：/${slashCommandName}`);
      return;
    }

    if (slashCommand?.behavior === 'client-action') {
      state.input = '';

      // 当前仅有少量本地动作，显式分支比通用路由更直观。
      // 当命令来源、权限校验、异步状态或跨模块动作明显增多时，应迁移为独立 Command Router。
      return;
    }

    await runQuery(query, { appendUser: true });
  }

  function handleEditUserMessage(messageId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const displayMessage = state.messages.find(item => item.id === messageId);

    if (
      displayMessage?.message.role === 'user' &&
      hasUserAttachments(displayMessage.message) &&
      !displayMessage.entryId
    ) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再编辑');
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

    const hasAttachments = hasUserAttachments(displayMessage.message);

    if (hasAttachments && !displayMessage.entryId) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再编辑');
      return;
    }

    const images = getUserImages(displayMessage.message);
    displayMessage.message.content = images.length > 0 ? [{ type: 'text', text: content }, ...images] : content;
    delete displayMessage.message.skillInvocation;
    markUserMessageAsOptimisticBranch(displayMessage);
    state.messages.splice(messageIndex + 1);
    await runQuery(content, {
      appendUser: false,
      branchFromEntryId: displayMessage.parentEntryId ?? null,
      reuseUserEntryId: hasAttachments ? displayMessage.entryId : undefined
    });
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

  function mergeContextFiles(files: ChatContextFile[]) {
    state.contextFiles = mergeChatContextFiles(state.contextFiles, files);
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

    const hasAttachments = hasUserAttachments(userMessage.message);

    if (hasAttachments && !userMessage.entryId) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再重新生成');
      return;
    }

    const userIndex = state.messages.findIndex(displayMessage => displayMessage.id === userMessage.id);

    if (userIndex === -1) {
      return;
    }

    state.messages.splice(userIndex + 1);
    await runQuery(getUserText(userMessage.message), {
      appendUser: false,
      branchFromEntryId: userMessage.parentEntryId ?? null,
      reuseUserEntryId: hasAttachments ? userMessage.entryId : undefined
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
