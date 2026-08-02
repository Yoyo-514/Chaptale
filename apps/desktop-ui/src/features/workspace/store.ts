import { defineStore } from 'pinia';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 工作区生命周期入口；迁移期复用 settings IPC，但不再由设置 UI 发起目录选择。 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    isOpening: false,
    error: ''
  }),
  actions: {
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

        const sessionStore = useSessionStore();
        await sessionStore.bindCwd(result.state.paths.currentCwd);
        await sessionStore.loadStorageDebugInfo();
        return true;
      } catch (error) {
        this.error = toErrorMessage(error);
        useNotificationStore().error('打开工作区失败', this.error);
        return false;
      } finally {
        this.isOpening = false;
      }
    }
  }
});
