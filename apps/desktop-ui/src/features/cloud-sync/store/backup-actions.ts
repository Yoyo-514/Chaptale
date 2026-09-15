import type { CloudBackupProgress, CloudProvider } from '@chaptale/ipc-contract';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { formatSize } from '../presentation';
import type { CloudSyncStoreContext, CloudWorkspaceScope } from './types';

function isCurrentWorkspace(scope: CloudWorkspaceScope) {
  const workspace = useWorkspaceStore();
  return scope.rootPath === workspace.rootPath && scope.revision === workspace.revision;
}

export const cloudBackupActions = {
  /** 切换作品先清旧清单，再发查询；旧归档不能在新作品下继续被选择。 */
  syncWorkspace(this: CloudSyncStoreContext): CloudWorkspaceScope {
    const workspace = useWorkspaceStore();
    if (this.workspaceScope && isCurrentWorkspace(this.workspaceScope)) return this.workspaceScope;
    this.workspaceScope = { rootPath: workspace.rootPath, revision: workspace.revision };
    ++this.bindingRequest;
    ++this.backupRequest;
    this.binding = null;
    this.bindingError = '';
    this.archives = [];
    this.quota = null;
    this.lastBackupAt = '';
    this.lastBackupError = null;
    this.backupError = '';
    this.notice = '';
    this.isBackupLoading = false;
    return this.workspaceScope;
  },

  async loadBinding(this: CloudSyncStoreContext) {
    const scope = this.syncWorkspace();
    const request = ++this.bindingRequest;
    try {
      const result = await getDesktopApi().cloudSync.getBinding();
      if (request !== this.bindingRequest || !isCurrentWorkspace(scope)) return;
      this.binding = result.ok ? result.binding : null;
      this.lastBackupAt = result.ok ? (result.lastBackupAt ?? '') : '';
      this.lastBackupError = result.ok ? result.lastBackupError : null;
      this.bindingError =
        !result.ok && result.code !== 'no-binding' && result.code !== 'no-workspace' ? result.message : '';
    } catch {
      if (request !== this.bindingRequest || !isCurrentWorkspace(scope)) return;
      this.binding = null;
      this.lastBackupAt = '';
      this.lastBackupError = null;
      this.bindingError = '';
    }
  },

  async refreshCloud(this: CloudSyncStoreContext) {
    await Promise.all([this.loadBinding(), this.loadBackups()]);
  },

  async loadBackups(this: CloudSyncStoreContext) {
    const scope = this.syncWorkspace();
    const request = ++this.backupRequest;
    this.isBackupLoading = true;
    this.backupError = '';
    try {
      const result = await getDesktopApi().cloudSync.listBackups();
      if (request !== this.backupRequest || !isCurrentWorkspace(scope)) return;
      if (!result.ok) {
        this.binding = null;
        this.archives = [];
        this.quota = null;
        if (result.code !== 'no-binding') this.backupError = result.message;
        return;
      }
      this.binding = result.binding;
      this.archives = result.archives;
      this.quota = result.quota;
      this.lastBackupError = result.lastBackupError;
    } catch (error) {
      if (request === this.backupRequest && isCurrentWorkspace(scope)) this.backupError = toErrorMessage(error);
    } finally {
      if (request === this.backupRequest) this.isBackupLoading = false;
    }
  },

  async bind(this: CloudSyncStoreContext, provider: CloudProvider, folderId: string | null, folderName: string) {
    const scope = this.syncWorkspace();
    this.backupError = '';
    this.notice = '';
    try {
      const result = await getDesktopApi().cloudSync.bind({ provider, folderId, folderName });
      if (!isCurrentWorkspace(scope)) return false;
      if (!result.ok) {
        this.backupError = result.message;
        return false;
      }
      await this.refreshCloud();
      if (!isCurrentWorkspace(scope)) return false;
      this.closeFolder();
      this.notice = `已绑定云端备份位置：${result.binding.folderName}`;
      return true;
    } catch (error) {
      if (isCurrentWorkspace(scope)) this.backupError = toErrorMessage(error);
      return false;
    }
  },

  async unbind(this: CloudSyncStoreContext) {
    const scope = this.syncWorkspace();
    this.backupError = '';
    this.notice = '';
    try {
      const result = await getDesktopApi().cloudSync.unbind();
      if (!isCurrentWorkspace(scope)) return;
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      ++this.bindingRequest;
      ++this.backupRequest;
      this.binding = null;
      this.archives = [];
      this.quota = null;
      this.isBackupLoading = false;
      this.lastBackupAt = '';
      this.lastBackupError = null;
      this.notice = '已解除这部作品的云端绑定；云端归档不会被删除';
    } catch (error) {
      if (isCurrentWorkspace(scope)) this.backupError = toErrorMessage(error);
    }
  },

  async createBackup(this: CloudSyncStoreContext) {
    if (this.isBackupRunning) return;
    const scope = this.syncWorkspace();
    this.isBackupRunning = true;
    this.backupError = '';
    this.notice = '';
    this.progress = { phase: 'packing', done: 0, total: 0 };
    try {
      const result = await getDesktopApi().cloudSync.createBackup();
      if (!isCurrentWorkspace(scope)) return;
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      this.notice = `已备份 ${result.files} 个文件（${formatSize(result.bytes)}）`;
      await this.refreshCloud();
    } catch (error) {
      if (isCurrentWorkspace(scope)) this.backupError = toErrorMessage(error);
    } finally {
      this.isBackupRunning = false;
      this.progress = null;
    }
  },

  async removeBackups(this: CloudSyncStoreContext, archiveIds: string[]) {
    if (!archiveIds.length) return;
    const scope = this.syncWorkspace();
    this.backupError = '';
    this.notice = '';
    const available = new Set(this.archives.map(archive => archive.id));
    if (archiveIds.some(id => !available.has(id))) {
      this.backupError = '归档清单已变化，请刷新后重新选择';
      return;
    }
    try {
      const result = await getDesktopApi().cloudSync.removeBackups({ archiveIds });
      if (!isCurrentWorkspace(scope)) return;
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      await this.loadBackups();
      if (!isCurrentWorkspace(scope)) return;
      if (result.failed.length > 0) {
        this.backupError = `${result.failed.length} 份没删掉：${result.failed[0]?.message ?? ''}`;
      }
      if (result.removed.length > 0) this.notice = `已从云端删除 ${result.removed.length} 份归档`;
    } catch (error) {
      if (isCurrentWorkspace(scope)) this.backupError = toErrorMessage(error);
    }
  },

  applyProgress(this: CloudSyncStoreContext, progress: CloudBackupProgress) {
    this.progress = progress;
  }
};
