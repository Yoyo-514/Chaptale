import type { CloudBackupProgress, CloudProvider } from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { formatSize } from '../presentation';
import type { CloudSyncStoreContext } from './types';

export const cloudBackupActions = {
  async loadBinding(this: CloudSyncStoreContext) {
    try {
      const result = await getDesktopApi().cloudSync.getBinding();
      this.binding = result.ok ? result.binding : null;
      this.lastBackupAt = result.ok ? (result.lastBackupAt ?? '') : '';
      this.lastBackupError = result.ok ? result.lastBackupError : null;
      // “没绑定”是正常状态；其他失败（没打开作品、作品缺清单）要留原因给界面说清楚。
      this.bindingError =
        !result.ok && result.code !== 'no-binding' && result.code !== 'no-workspace' ? result.message : '';
    } catch {
      this.binding = null;
      this.lastBackupAt = '';
      this.lastBackupError = null;
      this.bindingError = '';
    }
  },
  /** 绑定、上次备份时间与归档清单一起刷新：这两个界面打开一次就要这几样。 */
  async refreshCloud(this: CloudSyncStoreContext) {
    await Promise.all([this.loadBinding(), this.loadBackups()]);
  },
  /** 未绑定不是错误：界面据此显示"选一个云端位置"。 */
  async loadBackups(this: CloudSyncStoreContext) {
    this.isBackupLoading = true;
    this.backupError = '';
    try {
      const result = await getDesktopApi().cloudSync.listBackups();
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
      this.backupError = toErrorMessage(error);
    } finally {
      this.isBackupLoading = false;
    }
  },
  async bind(this: CloudSyncStoreContext, provider: CloudProvider, folderId: string | null, folderName: string) {
    this.backupError = '';
    this.notice = '';
    try {
      const result = await getDesktopApi().cloudSync.bind({ provider, folderId, folderName });
      if (!result.ok) {
        this.backupError = result.message;
        return false;
      }
      await this.refreshCloud();
      this.closeFolder();
      this.notice = `已绑定云端备份位置：${result.binding.folderName}`;
      return true;
    } catch (error) {
      this.backupError = toErrorMessage(error);
      return false;
    }
  },
  async unbind(this: CloudSyncStoreContext) {
    this.backupError = '';
    this.notice = '';
    try {
      const result = await getDesktopApi().cloudSync.unbind();
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      this.binding = null;
      this.archives = [];
      this.quota = null;
      this.notice = '已解除这部作品的云端绑定；云端归档不会被删除';
    } catch (error) {
      this.backupError = toErrorMessage(error);
    }
  },
  async createBackup(this: CloudSyncStoreContext) {
    if (this.isBackupRunning) return;
    this.isBackupRunning = true;
    this.backupError = '';
    this.notice = '';
    this.progress = { phase: 'packing', done: 0, total: 0 };
    try {
      const result = await getDesktopApi().cloudSync.createBackup();
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      this.notice = `已备份 ${result.files} 个文件（${formatSize(result.bytes)}）`;
      await this.refreshCloud();
    } catch (error) {
      this.backupError = toErrorMessage(error);
    } finally {
      this.isBackupRunning = false;
      this.progress = null;
    }
  },
  /**
   * 删除选中的归档。
   *
   * 结果逐条回来，所以这里分别说“删掉了几份”与“哪几份没删掉”——
   * 同批里有一份成功，不等于其余的也成了；失败的那份要留给作者再决定。
   */
  async removeBackups(this: CloudSyncStoreContext, archiveIds: string[]) {
    this.backupError = '';
    this.notice = '';
    try {
      const result = await getDesktopApi().cloudSync.removeBackups({ archiveIds });
      if (!result.ok) {
        this.backupError = result.message;
        return;
      }
      // 先刷新再写文案：刷新本身会清掉上一次的提示。
      await this.loadBackups();
      if (result.failed.length > 0) {
        this.backupError = `${result.failed.length} 份没删掉：${result.failed[0]?.message ?? ''}`;
      }
      if (result.removed.length > 0) {
        this.notice = `已从云端删除 ${result.removed.length} 份归档`;
      }
    } catch (error) {
      this.backupError = toErrorMessage(error);
    }
  },
  applyProgress(this: CloudSyncStoreContext, progress: CloudBackupProgress) {
    this.progress = progress;
  }
};
