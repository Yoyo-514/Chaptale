import { watch } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { findSlashCommand, getSlashCommandName } from '../utils/slash-commands';
import type { ChatState } from './chat-state';

/** 斜杠命令与 Web 搜索开关。 */
export function useChatCommands({ state }: { state: ChatState }) {
  const settingsStore = useSettingsStore();
  const notificationStore = useNotificationStore();

  async function loadSlashCommands() {
    try {
      state.slashCommands = await getDesktopApi().slashCommands.list();
    } catch (error) {
      notificationStore.error('加载命令失败', toErrorMessage(error));
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

  /** 返回 true 表示输入已被斜杠命令消化，不应再发送给 Agent。 */
  async function interceptSlashCommand(query: string): Promise<boolean> {
    const slashCommandName = getSlashCommandName(query);
    let slashCommand = findSlashCommand(query, state.slashCommands);

    // /settings 是应用的基础恢复入口，不依赖异步命令列表成功加载。
    if (slashCommandName === 'settings') {
      state.input = '';
      settingsStore.openPanel();
      return true;
    }

    if (slashCommandName && !slashCommand) {
      await loadSlashCommands();
      slashCommand = findSlashCommand(query, state.slashCommands);
    }

    if (slashCommandName && !slashCommand) {
      notificationStore.error(`未知命令：/${slashCommandName}`);
      return true;
    }

    if (slashCommand?.behavior === 'client-action') {
      state.input = '';

      // 当前仅有少量本地动作，显式分支比通用路由更直观。
      // 当命令来源、权限校验、异步状态或跨模块动作明显增多时，应迁移为独立 Command Router。
      return true;
    }

    return false;
  }

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

  return { loadSlashCommands, loadWebAccessSettings, handleToggleWebSearch, interceptSlashCommand };
}
