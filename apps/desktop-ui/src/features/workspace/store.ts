import { defineStore } from 'pinia';

import type { WorkspaceSyncState } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { confirmWorkspaceTransition } from '@/utils/workspace-transition';

/** 作品生命周期入口；迁移期复用 settings IPC，但不再由设置 UI 发起目录选择。 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    isOpening: false,
    newWorkspaceOpen: false,
    newWorkspaceParentPath: null as string | null,
    syncOpen: false,
    syncState: null as WorkspaceSyncState | null,
    syncLoading: false,
    syncError: '',
    syncRequest: 0,
    error: '',
    rootPath: null as string | null,
    displayName: null as string | null,
    hasChaptaleMetadata: false,
    revision: 0
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
      const changed = state.rootPath !== this.rootPath;
      this.rootPath = state.rootPath;
      this.displayName = state.displayName;
      this.hasChaptaleMetadata = state.hasChaptaleMetadata;
      if (changed) {
        this.revision += 1;
        this.syncState = null;
        this.syncError = '';
      }
    },
    async refreshSyncState() {
      const request = ++this.syncRequest;
      const revision = this.revision;
      this.syncLoading = true;
      this.syncError = '';
      try {
        const state = await getDesktopApi().workspace.getSyncState();
        if (request !== this.syncRequest || revision !== this.revision || state.rootPath !== this.rootPath) return;
        this.syncState = state;
      } catch (error) {
        if (request === this.syncRequest && revision === this.revision) {
          this.syncState = null;
          this.syncError = toErrorMessage(error);
        }
      } finally {
        if (request === this.syncRequest) this.syncLoading = false;
      }
    },
    createWorkspaceAt(parentPath: string) {
      this.newWorkspaceParentPath = parentPath;
      this.syncOpen = false;
      this.newWorkspaceOpen = true;
    },
    async openWorkspace(defaultPath?: string) {
      if (this.isOpening) {
        return false;
      }

      this.isOpening = true;
      this.error = '';

      try {
        if (!(await confirmWorkspaceTransition())) return false;
        const api = getDesktopApi();
        let nextState;
        if (defaultPath) {
          const selected = await api.workspace.selectParent({ defaultPath, purpose: 'open' });
          if (!selected) return false;
          nextState = await api.settings.update({ workspace: { path: selected } });
        } else {
          const result = await api.settings.selectWorkspaceDir();
          if (result.canceled || !result.state) return false;
          nextState = result.state;
        }

        useSettingsStore().applyStateSnapshot(nextState);
        await this.refreshState();

        await this.syncSession();
        return true;
      } catch (error) {
        this.error = toErrorMessage(error);
        useNotificationStore().error('打开作品失败', this.error);
        return false;
      } finally {
        this.isOpening = false;
      }
    },
    /** 关闭作品：此后没有会话落脚点，聊天随之停用，直到再次新建或打开作品。 */
    async closeWorkspace() {
      if (!(await useSettingsStore().update({ workspace: { path: null } }))) return;
      await this.refreshState();
      // update 已把会话 cwd 绑成空；这里补一次存储信息，免得设置面板还显示上一部作品的目录。
      await useSessionStore().loadStorageDebugInfo();
    },
    async openRecent(path: string) {
      if (!(await useSettingsStore().update({ workspace: { path } }))) return;
      await this.refreshState();
      await this.syncSession();
    }
  }
});
