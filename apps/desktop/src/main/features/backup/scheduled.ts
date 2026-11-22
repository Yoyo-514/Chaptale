import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { CreationClient } from '@chaptale/creation/contracts';

import { CLOUD_PROVIDER_LABELS } from '../../../bridge/cloud-sync';
import type {
  ScheduledBackupFailure,
  ScheduledBackupReport,
  ScheduledBackupSettings,
  ScheduledBackupState
} from '../../../bridge/scheduled-backup';
import type { SettingsService } from '../../core/settings/service';
import { readOptionalTextFile, writeJsonFile } from '../../infra/filesystem/files';
import type { BackupDevice } from '../cloud-sync/package-name';
import type { CloudSyncService } from '../cloud-sync/service';
import { syncBackupAccount, type BackupReceipts } from './cloud';
import { assertBackupDirectory, AUTO_BACKUP_LIMIT, packageValue, saveLocalBackup, scanLocalBackups } from './local';

type BackupProgress = {
  local?: { directory: string; at: number };
  uploaded?: Record<string, BackupReceipts>;
};

type ScheduledWorkBackupOptions = {
  creation: Pick<CreationClient, 'request'>;
  settings: SettingsService;
  dataDirectory: () => Promise<string>;
  cloud: CloudSyncService;
  device: () => Promise<BackupDevice>;
  onChange: () => void;
  onFailure: (failure: ScheduledBackupFailure) => void;
};

const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function folderFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return '找不到备份文件夹。请接回存储设备，或更换备份位置。';
  if (code === 'EACCES' || code === 'EPERM') return '无法访问备份文件夹。请检查权限，或更换备份位置。';
  return failureMessage(error);
}

async function readProgress(path: string): Promise<BackupProgress> {
  const raw = await readOptionalTextFile(path);
  return raw === undefined ? {} : (JSON.parse(raw) as BackupProgress);
}

/** 作品定时备份只认本安装的自动包；每一轮先完成本机保存，再补传最新的一份。 */
export class ScheduledWorkBackups {
  private folderIssue: { directory: string; message: string } | null = null;
  private readonly failed = new Map<string, ScheduledBackupFailure>();
  private running?: Promise<ScheduledBackupReport>;
  private cloudAbort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private ready = false;
  private closing = false;

  constructor(private readonly options: ScheduledWorkBackupOptions) {}

  async getState(): Promise<ScheduledBackupState> {
    const settings = await this.options.settings.readScheduledBackup();
    const progress = settings.directory ? await readProgress(await this.progressPath()) : {};
    return {
      settings,
      lastBackupAt: progress.local?.directory === settings.directory ? progress.local.at : null,
      folderError: this.folderIssue?.directory === settings.directory ? this.folderIssue.message : null,
      failures: [...this.failed.values()]
    };
  }

  /** 作品宿主第一次就绪后，检查一轮并开始计时。 */
  async start(): Promise<void> {
    if (this.ready || this.closing) return;
    this.ready = true;
    this.schedule(await this.options.settings.readScheduledBackup(), true);
  }

  async configure(settings: ScheduledBackupSettings): Promise<ScheduledBackupState> {
    const previous = await this.options.settings.readScheduledBackup();
    const changedFolder = settings.directory !== previous.directory;
    if (settings.enabled && !settings.directory) throw new Error('请先选择备份文件夹');
    if (changedFolder && settings.directory) {
      await assertBackupDirectory(settings.directory, await this.options.dataDirectory());
    }
    await this.options.settings.setScheduledBackup(settings);
    if (changedFolder) {
      this.folderIssue = null;
      this.failed.delete('local');
    }
    if (!settings.enabled || changedFolder) this.cloudAbort?.abort();
    if (settings.enabled !== previous.enabled || settings.intervalMinutes !== previous.intervalMinutes) {
      this.schedule(settings, !previous.enabled);
    }
    this.options.onChange();
    return this.getState();
  }

  /** 取消在途云端请求，等本机保存结束，再做一轮只保存到本机的检查。 */
  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    this.cloudAbort?.abort();
    await this.running?.catch(error => this.fail('local', '作品定时备份失败', failureMessage(error)));
    if (this.ready) await this.runOnce({ upload: false });
  }

  /** manual 为作者点「立即备份」：定时备份关着也照常检查。同时只跑一轮，后来的请求等这一轮的结果。 */
  runOnce({ upload, manual = false }: { upload: boolean; manual?: boolean }): Promise<ScheduledBackupReport> {
    if (this.running) return this.running;
    const controller = new AbortController();
    this.cloudAbort = controller;
    this.running = this.backup(upload, manual, controller.signal).finally(() => {
      this.running = undefined;
      this.cloudAbort = undefined;
    });
    return this.running;
  }

  private schedule(settings: ScheduledBackupSettings, checkNow: boolean): void {
    clearInterval(this.timer);
    if (!this.ready || this.closing || !settings.enabled) return;
    const check = () => {
      // 等旧轮收尾的检查可能落在退出之后。
      if (this.closing) return;
      void this.runOnce({ upload: true }).catch(error => this.fail('local', '作品定时备份失败', failureMessage(error)));
    };
    this.timer = setInterval(check, settings.intervalMinutes * 60_000);
    this.timer.unref();
    if (checkNow) {
      // 关闭后马上重开时，要等旧轮收尾，再按刚保存的设置检查。
      if (this.running) void this.running.then(check, check);
      else check();
    }
  }

  private async backup(upload: boolean, manual: boolean, signal: AbortSignal): Promise<ScheduledBackupReport> {
    let saved = 0;
    const report = () => ({ saved, failures: [...this.failed.values()] });
    const { enabled, directory } = await this.options.settings.readScheduledBackup();
    if ((!enabled && !manual) || !directory) return report();
    const data = await this.options.dataDirectory();
    const device = await this.options.device();
    let scan;
    try {
      await assertBackupDirectory(directory, data);
      scan = await scanLocalBackups(directory, device);
    } catch (error) {
      this.folderIssue = { directory, message: folderFailure(error) };
      this.fail('local', '备份文件夹不可用', this.folderIssue.message);
      return report();
    }
    if (this.folderIssue) {
      this.folderIssue = null;
      this.options.onChange();
    }

    const progressPath = this.progressPathIn(data);
    const progress = await readProgress(progressPath);
    const saveProgress = () => writeJsonFile(progressPath, progress);
    // 换目录或删过本机包后，同一分钟再备份也要避开已上传的名字。
    for (const receipts of Object.values(progress.uploaded ?? {})) {
      for (const { name } of Object.values(receipts)) scan.names.add(name.toLowerCase());
    }
    const changedDirectory = progress.local && progress.local.directory !== directory;
    const sources = packageValue(await this.options.creation.request('listWorkBackupSources', {}));
    const newest = new Map<string, string>();
    let localFailure: string | undefined;
    for (const { workId, modifiedAt } of sources) {
      const backups = scan.byWork.get(workId) ?? [];
      if (changedDirectory || !backups[0] || backups[0].modifiedAt < modifiedAt) {
        try {
          backups.unshift(await saveLocalBackup(this.options.creation, workId, directory, device, scan.names));
          saved++;
          progress.local = { directory, at: Date.now() };
          for (const old of backups.slice(AUTO_BACKUP_LIMIT)) await rm(join(directory, old.name), { force: true });
        } catch (error) {
          localFailure ??= failureMessage(error);
        }
      }
      if (backups[0]) newest.set(workId, backups[0].name);
    }
    if (saved) {
      await saveProgress();
      this.options.onChange();
    }
    if (localFailure) this.fail('local', '作品定时备份失败', localFailure);
    else this.recover('local');
    if (!upload || signal.aborted || !newest.size) return report();

    const { cloud } = this.options;
    for (const account of await cloud.listBackupAccounts()) {
      if (signal.aborted) return report();
      const key = `${account.provider}:${account.accountId}`;
      const receipts = ((progress.uploaded ??= {})[key] ??= {});
      const title = `${CLOUD_PROVIDER_LABELS[account.provider]} 定时备份失败`;
      try {
        const result = await syncBackupAccount({
          cloud,
          account,
          directory,
          device,
          latest: newest,
          receipts,
          saveProgress,
          signal
        });
        if (!result || signal.aborted) continue;
        if (result.failure) this.fail(key, title, result.failure);
        else this.recover(key);
      } catch (error) {
        if (!signal.aborted) this.fail(key, title, failureMessage(error));
      }
    }
    return report();
  }

  private async progressPath(): Promise<string> {
    return this.progressPathIn(await this.options.dataDirectory());
  }

  private progressPathIn(data: string): string {
    return join(data, 'scheduled-backup.json');
  }

  /** 同一项失败只通知一次；原因变了，状态栏提示跟着更新。 */
  private fail(key: string, title: string, message: string): void {
    const known = this.failed.has(key);
    this.failed.set(key, { title, message });
    if (!known) this.options.onFailure({ title, message });
    this.options.onChange();
  }

  private recover(key: string): void {
    if (this.failed.delete(key)) this.options.onChange();
  }
}
