import { defineStore } from 'pinia';

import type { ChaptaleSettingsState, ChaptaleTheme, UpdateChaptaleSettingsPayload } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { applyTheme, cacheTheme } from '../theme';

export type SettingsSection = 'writing' | 'llm' | 'prompt' | 'skills' | 'mcp' | 'permissions' | 'cloudSync' | 'files';

/** 设置快照是主题的事实源；每次拿到新快照都据此校准界面与启动期缓存。 */
function syncTheme(state: ChaptaleSettingsState) {
  applyTheme(state.settings.theme);
  cacheTheme(state.settings.theme);
}

/** 设置面板与应用设置快照；模型和指令由 agent-host 管理，不在这里保存副本。 */
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    state: undefined as ChaptaleSettingsState | undefined,
    activeSection: 'writing' as SettingsSection,
    isOpen: false,
    isLoading: false,
    error: ''
  }),
  actions: {
    /** 清空错误、捕获异常并发通知；返回 undefined 表示失败且已提示。 */
    async runAction<T>(title: string, action: () => Promise<T>): Promise<T | undefined> {
      this.error = '';
      try {
        return await action();
      } catch (error) {
        this.error = toErrorMessage(error);
        useNotificationStore().error(title, this.error);
        return undefined;
      }
    },

    openPanel(section?: SettingsSection) {
      this.isOpen = true;
      if (section) this.activeSection = section;
      void this.load();
    },

    closePanel() {
      this.isOpen = false;
    },

    setSection(section: SettingsSection) {
      this.activeSection = section;
    },

    applyStateSnapshot(state: ChaptaleSettingsState) {
      this.state = state;
      syncTheme(state);
    },

    async load() {
      this.isLoading = true;
      try {
        const state = await this.runAction('读取设置失败', () => getDesktopApi().settings.getState());
        if (state) this.applyStateSnapshot(state);
      } finally {
        this.isLoading = false;
      }
    },

    async update(payload: UpdateChaptaleSettingsPayload) {
      this.isLoading = true;
      try {
        const state = await this.runAction('更新设置失败', () => getDesktopApi().settings.update(payload));
        if (state) this.applyStateSnapshot(state);
        return Boolean(state);
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * 切换界面主题。
     *
     * 先落到界面再落盘：换主题是纯视觉操作，压着一次 IPC 往返会让点击明显发木。
     * 写失败时下一次 load 会把界面纠正回设置里的值。
     */
    async setTheme(theme: ChaptaleTheme) {
      applyTheme(theme);
      cacheTheme(theme);
      await this.update({ theme });
    },

    async openConfigDir() {
      await this.runAction('打开配置目录失败', () => getDesktopApi().settings.openConfigDir());
    }
  }
});
