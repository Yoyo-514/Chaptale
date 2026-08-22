import type {
  ChaptaleSettingsState,
  ChaptaleTheme,
  UpdateChaptaleSettingsPayload,
  UpdateWebToolsSettingsPayload
} from '@chaptale/ipc-contract';

import { useSessionStore } from '@/features/sessions';
import { getDesktopApi } from '@/utils/desktop-api';

import { applyTheme, cacheTheme } from '../theme';
import type { SettingsStoreContext } from './types';

/** 应用设置与 Web Access 的读写动作；每次成功响应都整体替换状态快照。 */
export const workspaceSettingsActions = {
  applyStateSnapshot(this: SettingsStoreContext, state: ChaptaleSettingsState) {
    this.state = state;
    syncTheme(state);
  },

  async load(this: SettingsStoreContext) {
    this.isLoading = true;

    try {
      const state = await this.runAction('读取设置失败', () => getDesktopApi().settings.getState());
      if (state) {
        this.state = state;
        syncTheme(state);
        await bindSessionCwd(this, state);
      }
    } finally {
      this.isLoading = false;
    }
  },

  async update(this: SettingsStoreContext, payload: UpdateChaptaleSettingsPayload) {
    this.isLoading = true;

    try {
      const state = await this.runAction('更新设置失败', () => getDesktopApi().settings.update(payload));
      if (state) {
        this.state = state;
        syncTheme(state);
        await bindSessionCwd(this, state);
      }
    } finally {
      this.isLoading = false;
    }
  },

  async updateWebTools(this: SettingsStoreContext, payload: UpdateWebToolsSettingsPayload) {
    this.isLoading = true;

    try {
      const state = await this.runAction('更新联网设置失败', () => getDesktopApi().settings.updateWebTools(payload));
      if (!state) {
        return false;
      }

      this.state = state;
      return true;
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
  async setTheme(this: SettingsStoreContext, theme: ChaptaleTheme) {
    applyTheme(theme);
    cacheTheme(theme);
    await this.update({ theme });
  },

  async useGlobalStorage(this: SettingsStoreContext) {
    await this.update({ storage: { mode: 'global' } });
  },

  async openConfigDir(this: SettingsStoreContext) {
    await this.runAction('打开配置目录失败', () => getDesktopApi().settings.openConfigDir());
  }
};

/** 设置快照是主题的事实源；每次拿到新快照都据此校准界面与启动期缓存。 */
function syncTheme(state: ChaptaleSettingsState) {
  applyTheme(state.settings.theme);
  cacheTheme(state.settings.theme);
}

async function bindSessionCwd(store: SettingsStoreContext, state: ChaptaleSettingsState) {
  // 只接受 Main 返回的 currentCwd；Renderer 不自行拼路径，避免 workspace 切换后误绑定旧会话。
  await store.runAction('绑定会话目录失败', () => useSessionStore().bindCwd(state.paths.currentCwd));
}
