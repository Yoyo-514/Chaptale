import { defineStore } from 'pinia';

import {
  CLOUD_PROVIDER_LABELS,
  isCloudProvider,
  type CloudBackup,
  type CloudBackupTarget,
  type CloudFailure,
  type CloudProvider,
  type CloudSyncState
} from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export type CloudBackupItem = CloudBackup & { provider: CloudProvider };

type BackupMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  items?: BackupMenuItem[];
};
const backupMenuPrefix = 'cloud-backup:';

type BackupTransfer = { item: CloudBackupItem; action: 'download' | 'delete'; abandoned: boolean };

/** 主进程拒绝请求时，和服务商报错走同一条展示路径。 */
async function attempt<T extends { ok: boolean }>(request: () => Promise<T>): Promise<T | CloudFailure> {
  try {
    return await request();
  } catch (cause) {
    return { ok: false, code: 'failed', message: toErrorMessage(cause) };
  }
}

/** 云端账户，以及作品包在云端应用目录里的备份、列出、取回与删除。 */
export const useCloudSyncStore = defineStore('cloudSync', {
  state: () => ({
    state: null as CloudSyncState | null,
    isLoading: false,
    error: '',
    busy: null as CloudProvider | null,
    /** 正在备份的作品标题；同一时间只备份一部。 */
    backingUp: null as string | null,
    restoreOpen: false,
    backups: [] as CloudBackupItem[],
    backupsLoading: false,
    backupsError: '',
    transferring: null as BackupTransfer | null
  }),
  getters: {
    availability: state => state.state?.availability ?? [],
    accounts: state => state.state?.accounts ?? [],
    backupMenu(): BackupMenuItem {
      if (this.backingUp !== null) {
        return { id: `${backupMenuPrefix}busy`, label: `正在上传《${this.backingUp}》…`, disabled: true };
      }
      const disabled = this.isLoading;
      if (!this.accounts.length) return { id: `${backupMenuPrefix}settings`, label: '登录云端账户…', disabled };
      if (this.accounts.length === 1) {
        const { provider } = this.accounts[0]!;
        return { id: backupMenuPrefix + provider, label: `上传到 ${CLOUD_PROVIDER_LABELS[provider]}`, disabled };
      }
      return {
        id: `${backupMenuPrefix}menu`,
        label: '上传到云端',
        disabled,
        items: [
          ...this.accounts.map(({ provider }) => ({
            id: backupMenuPrefix + provider,
            label: CLOUD_PROVIDER_LABELS[provider]
          })),
          { id: `${backupMenuPrefix}all`, label: '全部云端账户', separatorBefore: true }
        ]
      };
    }
  },
  actions: {
    async load() {
      this.isLoading = true;
      this.error = '';
      try {
        this.state = await getDesktopApi().cloudSync.getState();
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.isLoading = false;
      }
    },
    async signIn(provider: CloudProvider) {
      if (this.busy) return;
      this.busy = provider;
      this.error = '';
      try {
        const result = await getDesktopApi().cloudSync.beginAuth({ provider });
        if (!result.ok) {
          if (result.code !== 'canceled') this.error = result.message;
          return;
        }
        await this.load();
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.busy = null;
      }
    },
    async cancelSignIn() {
      await getDesktopApi().cloudSync.cancelAuth();
    },
    async signOut(provider: CloudProvider) {
      if (this.busy) return;
      this.busy = provider;
      this.error = '';
      try {
        this.state = await getDesktopApi().cloudSync.signOut({ provider });
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.busy = null;
      }
    },
    openAccountSettings() {
      useSettingsStore().openPanel('cloudSync');
    },
    selectBackup(id: string, work: { id: string; title: string } | undefined): boolean {
      if (!id.startsWith(backupMenuPrefix)) return false;
      const target = id.slice(backupMenuPrefix.length);
      if (target === 'settings') this.openAccountSettings();
      else if (work && (target === 'all' || isCloudProvider(target))) void this.backupWork(work, target);
      return true;
    },
    async backupWork(work: { id: string; title: string }, target: CloudBackupTarget) {
      this.backingUp = work.title;
      const notifications = useNotificationStore();
      const subject = `《${work.title}》`;
      const id = notifications.startProgress(`${subject}云端备份`, '正在生成作品包…');
      const result = await attempt(() =>
        getDesktopApi().cloudSync.backupWork({ workId: work.id, target }, ({ provider, current, total }) => {
          const position = total > 1 ? `（${current}/${total}）` : '';
          notifications.updateProgress(id, `正在上传到 ${CLOUD_PROVIDER_LABELS[provider]}${position}`);
        })
      );
      this.backingUp = null;
      if (!result.ok) {
        notifications.finishProgress(id, 'error', `${subject}备份失败`, result.message);
        return;
      }
      const successful = result.uploads.filter(({ result: upload }) => upload.ok).length;
      const complete = successful === result.uploads.length;
      const details = result.uploads.map(
        ({ provider, result: upload }) => `${CLOUD_PROVIDER_LABELS[provider]}：${upload.ok ? '已上传' : upload.message}`
      );
      const outcome = complete ? '已备份到云端' : successful ? '只备份到部分云端账户' : '备份失败';
      notifications.finishProgress(id, complete ? 'success' : 'error', `${subject}${outcome}`, details.join('\n'));
    },
    /** 没登录时也打开，列表里给出登录入口。 */
    async openRestore() {
      this.restoreOpen = true;
      if (!this.state) await this.load();
      await this.loadBackups();
    },
    setRestoreOpen(open: boolean) {
      this.restoreOpen = open;
      // 重新打开列表时，上一轮下载仍按放弃处理。
      if (!open && this.transferring?.action === 'download') this.transferring.abandoned = true;
    },
    async loadBackups() {
      this.backupsLoading = true;
      this.backupsError = '';
      const backups: CloudBackupItem[] = [];
      const errors: string[] = [];
      for (const { provider } of this.accounts) {
        const result = await attempt(() => getDesktopApi().cloudSync.listBackups({ provider }));
        if (result.ok) backups.push(...result.backups.map(item => ({ ...item, provider })));
        else errors.push(`${CLOUD_PROVIDER_LABELS[provider]}：${result.message}`);
      }
      const when = (item: CloudBackupItem) => item.info?.at ?? item.modifiedAt ?? '';
      this.backups = backups.sort((left, right) => when(right).localeCompare(when(left)));
      this.backupsError = errors.join('；');
      this.backupsLoading = false;
    },
    /** 下载到本机临时目录，返回路径交给作品包导入流程。 */
    async downloadBackup(item: CloudBackupItem): Promise<string | null> {
      this.transferring = { item, action: 'download', abandoned: false };
      this.backupsError = '';
      try {
        const result = await attempt(() =>
          getDesktopApi().cloudSync.downloadBackup({ provider: item.provider, fileId: item.id })
        );
        if (this.transferring.abandoned) {
          if (result.ok) await this.discardDownload(result.path);
          return null;
        }
        if (result.ok) return result.path;
        this.backupsError = result.message;
        return null;
      } finally {
        this.transferring = null;
      }
    },
    discardDownload(path: string) {
      return getDesktopApi().cloudSync.discardDownload(path);
    },
    async deleteBackup(item: CloudBackupItem) {
      this.transferring = { item, action: 'delete', abandoned: false };
      this.backupsError = '';
      const result = await attempt(() =>
        getDesktopApi().cloudSync.deleteBackup({ provider: item.provider, fileId: item.id })
      );
      this.transferring = null;
      if (result.ok)
        this.backups = this.backups.filter(other => other.provider !== item.provider || other.id !== item.id);
      else this.backupsError = result.message;
    }
  }
});
