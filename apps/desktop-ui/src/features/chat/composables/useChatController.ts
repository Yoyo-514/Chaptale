import { computed, onMounted, reactive, watch } from 'vue';

import type { ChaptaleReasoningEffort } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi } from '@/utils/desktop-api';

import { createDisplayMessage } from '../utils/message/display-message';
import { createChatState } from './chat-state';
import { useAssistantStreamingMessages } from './useAssistantStreamingMessages';
import { useChatCommands } from './useChatCommands';
import { useChatContextFiles } from './useChatContextFiles';
import { useChatEditing } from './useChatEditing';
import { useChatMessages } from './useChatMessages';
import { useChatStreaming } from './useChatStreaming';

/**
 * ChatView 的组合门面：状态与各职责子 composable 在此装配，
 * 对组件暴露稳定的 handler 集合。具体逻辑见 useChatMessages /
 * useChatStreaming / useChatCommands / useChatContextFiles / useChatEditing。
 */
export function useChatController() {
  const sessionStore = useSessionStore();
  const settingsStore = useSettingsStore();
  const notificationStore = useNotificationStore();
  const state = reactive(createChatState());

  const isWelcome = computed(() => !state.isLoadingMessages && state.messages.length === 0);
  // 模型没配好是首启最常见的断点：单独暴露给状态栏做醒目提示。
  // 读取中（models 还没到）不算缺失，否则每次启动都会先闪一下警告。
  const isModelMissing = computed(() => {
    const models = settingsStore.models;
    return models !== undefined && !models.defaultModel;
  });
  const currentModelLabel = computed(() => {
    // 默认模型持久化于 models.json（models.setDefault），这里读 models 列表的 defaultModel。
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
  /** 还没开始过任何会话：空态才值得解释一遍专员与技能的分工，老作者不必再看。 */
  const isFirstRun = computed(() => sessionStore.sessions.every(session => session.messageCount === 0));

  const assistantStreaming = useAssistantStreamingMessages({
    getMessages: () => state.messages,
    createDisplayMessage
  });

  function getDesktopApiOrNotify() {
    try {
      return getDesktopApi();
    } catch {
      notificationStore.error('当前界面需要在 Chaptale 桌面端中运行');
      return undefined;
    }
  }

  const messages = useChatMessages({ state, assistantStreaming, getDesktopApiOrNotify });
  const commands = useChatCommands({ state });
  const streaming = useChatStreaming({
    state,
    assistantStreaming,
    currentLeafId: messages.currentLeafId,
    loadCurrentSessionMessages: messages.loadCurrentSessionMessages,
    getDesktopApiOrNotify
  });
  const contextFiles = useChatContextFiles({ state, getDesktopApiOrNotify });
  const editing = useChatEditing({ state, runQuery: streaming.runQuery });

  /** 按运行状态把输入路由到普通 prompt、steer 或中断。 */
  async function handleSend(): Promise<void> {
    const query = state.input.trim();

    if (state.isCancelling) {
      return;
    }

    // 回复中的空输入保留中断语义；模型重试时可能同时处于 connecting/replying。
    if (state.isReplying && !query) {
      await streaming.cancelActiveRun();
      return;
    }

    if (state.isSubmittingSteer || (state.isConnecting && !state.isReplying)) {
      return;
    }

    if (!query) {
      return;
    }

    if (await commands.interceptSlashCommand(query)) {
      return;
    }

    if (state.isReplying) {
      await streaming.steer(query);
      return;
    }

    await streaming.runQuery(query, { appendUser: true });
  }

  /** queued 用户消息整体恢复 SDK 队列；持久化消息仍走分支编辑。 */
  async function handleEditUserMessage(messageId: string): Promise<void> {
    const displayMessage = state.messages.find(item => item.id === messageId);

    if (displayMessage?.deliveryState === 'queued') {
      await streaming.restorePendingMessages();
      return;
    }

    editing.handleEditUserMessage(messageId);
  }

  function handleOpenSettings(section: 'workspace' | 'llm' = 'workspace') {
    settingsStore.openPanel(section);
  }

  /**
   * 切换本轮推理档位；空串回到跟随模型配置。
   *
   * 不进 useChatCommands：那里每个动作都要落设置或调 IPC，而这一项刻意只改内存态——
   * 它描述的是「接下来这次发送要想多深」，不该在作者不知情的时候被记住。
   */
  function handleSelectReasoningEffort(value: ChaptaleReasoningEffort | '') {
    state.reasoningEffort = value;
  }

  onMounted(() => {
    void messages.loadCurrentSessionMessages();
    void commands.loadWebAccessSettings();
    void commands.loadSlashCommands();

    // 状态条需要默认模型信息；若设置面板未打开过，models 尚未加载。
    if (!settingsStore.models) {
      void settingsStore.loadModels();
    }
  });

  watch(
    () => sessionStore.currentSessionId,
    async (sessionId, previousSessionId) => {
      if (!sessionId || sessionId === previousSessionId) {
        return;
      }

      messages.currentLeafId.value = null;
      await Promise.all([messages.loadCurrentSessionMessages(), commands.loadSlashCommands()]);
    }
  );

  return {
    state,
    isWelcome,
    isModelMissing,
    currentModelLabel,
    workspaceLabel,
    recentSessions,
    isFirstRun,
    handleSelectRecentSession: messages.handleSelectRecentSession,
    handleSend,
    cancelActiveRun: streaming.cancelActiveRun,
    handleEditUserMessage,
    handleSaveUserMessage: editing.handleSaveUserMessage,
    handleCancelEdit: editing.handleCancelEdit,
    handleRegenerateAssistantMessage: editing.handleRegenerateAssistantMessage,
    handleAddContextFiles: contextFiles.handleAddContextFiles,
    addWorkspaceFiles: contextFiles.addWorkspaceFiles,
    handleDropContextFiles: contextFiles.handleDropContextFiles,
    handleRemoveContextFile: contextFiles.handleRemoveContextFile,
    handleOpenSettings,
    handleToggleWebSearch: commands.handleToggleWebSearch,
    handleSelectReasoningEffort,
    handleSwitchBranch: messages.handleSwitchBranch,
    /** 会话压缩写入新的 compaction 分支后，原地重载当前消息树。 */
    reloadCurrentSessionMessages: messages.loadCurrentSessionMessages
  };
}
