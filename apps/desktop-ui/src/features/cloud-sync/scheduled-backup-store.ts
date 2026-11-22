import { defineStore } from 'pinia';

import type { ScheduledBackupPatch, ScheduledBackupReport, ScheduledBackupState } from '@chaptale/desktop/bridge';

import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

function describeReport({ saved, failures }: ScheduledBackupReport) {
  if (!failures.length) {
    return {
      kind: 'success' as const,
      title: saved ? `已备份 ${saved} 部作品` : '没有改动，不用备份',
      description: ''
    };
  }
  return {
    kind: 'error' as const,
    title: saved ? `已在本机备份 ${saved} 部作品，部分备份失败` : '备份失败',
    description: failures.map(({ title, message }) => `${title}：${message}`).join('\n')
  };
}

/** 作品定时备份的设置与最近状态；备份本身在主进程按间隔运行。 */
export const useScheduledBackupStore = defineStore('scheduled-backup', {
  state: () => ({
    state: undefined as ScheduledBackupState | undefined,
    busy: false,
    /** 「立即备份」进行中；这期间的失败并入它的结果通知。 */
    backingUp: false,
    error: '',
    connected: false
  }),
  actions: {
    /** 应用启动时接上主进程事件：状态变化时刷新，失败送通知中心。 */
    connect() {
      if (this.connected) return;
      this.connected = true;
      getDesktopApi().scheduledBackup.subscribe(event => {
        if (event.kind === 'changed') void this.load();
        else if (!this.backingUp) useNotificationStore().error(event.title, event.message);
      });
      void this.load();
    },

    async run(action: () => Promise<ScheduledBackupState>) {
      this.busy = true;
      this.error = '';
      try {
        this.state = await action();
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.busy = false;
      }
    },

    load() {
      return this.run(() => getDesktopApi().scheduledBackup.getState());
    },

    /** 还没选文件夹时打开开关，主进程会先弹出文件夹选择框；取消则保持关闭。 */
    update(patch: ScheduledBackupPatch) {
      return this.run(() => getDesktopApi().scheduledBackup.update(patch));
    },

    chooseDirectory() {
      return this.run(() => getDesktopApi().scheduledBackup.chooseDirectory());
    },

    async openDirectory() {
      this.error = '';
      try {
        await getDesktopApi().scheduledBackup.openDirectory();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    /** 没选文件夹时主进程先弹选择框，这时不显示进度，免得取消后留下一条进行中的通知。 */
    async backupNow() {
      const notifications = useNotificationStore();
      const progress = this.state?.settings.directory
        ? notifications.startProgress('立即备份', '正在检查作品改动…')
        : undefined;
      this.backingUp = true;
      let result: ReturnType<typeof describeReport> | null;
      try {
        const report = await getDesktopApi().scheduledBackup.backupNow();
        result = report && describeReport(report);
      } catch (error) {
        result = { kind: 'error', title: '备份失败', description: toErrorMessage(error) };
      } finally {
        this.backingUp = false;
      }
      if (progress !== undefined) {
        notifications.finishProgress(progress, result!.kind, result!.title, result!.description);
      } else if (result) {
        notifications.push(result.kind, result.title, result.description || undefined);
      }
    },

    pickBackup() {
      return getDesktopApi().scheduledBackup.pickBackup();
    }
  }
});
