import { defineStore } from 'pinia';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 工作区生命周期入口；迁移期复用 settings IPC，但不再由设置 UI 发起目录选择。 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    isOpening: false,
    error: '',
    rootPath: null as string | null,
    displayName: null as string | null,
    hasChaptaleMetadata: false,
    revision: 0,
    showInternalFiles: false
  }),
  actions: {
    async syncSession() {
      const sessionStore = useSessionStore();
      if (this.rootPath) {
        await sessionStore.bindCwd(this.rootPath);
        await sessionStore.loadStorageDebugInfo();
      }
    },
    async refreshState() {
      const state = await getDesktopApi().workspace.getState();
      this.rootPath = state.rootPath;
      this.displayName = state.displayName;
      this.hasChaptaleMetadata = state.hasChaptaleMetadata;
      this.revision += 1;
    },
    async openWorkspace() {
      if (this.isOpening) {
        return false;
      }

      this.isOpening = true;
      this.error = '';

      try {
        const result = await getDesktopApi().settings.selectWorkspaceDir();

        if (result.canceled || !result.state) {
          return false;
        }

        useSettingsStore().applyStateSnapshot(result.state);
        await this.refreshState();

        await this.syncSession();
        return true;
      } catch (error) {
        this.error = toErrorMessage(error);
        useNotificationStore().error('打开工作区失败', this.error);
        return false;
      } finally {
        this.isOpening = false;
      }
    },
    async closeWorkspace() {
      await useSettingsStore().update({ storage: { mode: 'global' } });
      await this.refreshState();
    },
    async openRecent(path: string) {
      await useSettingsStore().update({ storage: { mode: 'workspace', workspacePath: path } });
      await this.refreshState();
    }
  }
});
