import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CreationResult, WorkPackageInfo, WorkPackageSummary } from '@chaptale/creation/contracts';

import type {
  CloudBackupProgress,
  CloudBackupWorkArgs,
  CloudBackupWorkResult,
  CloudBackupFileArgs,
  CloudDownloadBackupResult
} from '../../../bridge/cloud-sync';
import type { CloudSyncService } from './service';

/** 云端文件名：作品标题加本机备份时间；标题里服务商不接受的字符换成下划线。 */
export function backupName(title: string, at: Date, { manuscripts, resources, images }: WorkPackageSummary): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const stem = `${title.replace(/[\\/:*?"<>|]/g, '_')}_${day}_${two(at.getHours())}${two(at.getMinutes())}`;
  return `${stem}_m${manuscripts}-r${resources}-i${images}.chaptale`;
}

/** 作品与云端之间的往返：备份时先导出作品包再上传，恢复时把云端的包下载到临时目录交给导入流程。 */
export class CloudBackups {
  /** 只清理由本进程下载、已交给恢复流程的作品包。 */
  private readonly downloads = new Set<string>();

  constructor(
    private readonly cloud: CloudSyncService,
    /** 把作品导出成本机路径上的作品包。 */
    private readonly exportWork: (workId: string, path: string) => Promise<CreationResult<null>>,
    private readonly inspectPackage: (path: string) => Promise<CreationResult<WorkPackageInfo>>
  ) {}

  async backupWork(
    { workId, target }: CloudBackupWorkArgs,
    onUpload: (progress: CloudBackupProgress) => void
  ): Promise<CloudBackupWorkResult> {
    const { accounts } = await this.cloud.getState();
    const selected = accounts.filter(({ provider }) => target === 'all' || provider === target);
    if (!selected.length) return { ok: false, code: 'not-signed-in', message: '请先登录云端账号' };

    const dir = await mkdtemp(join(tmpdir(), 'chaptale-backup-'));
    try {
      const path = join(dir, 'work.chaptale');
      const exported = await this.exportWork(workId, path);
      if (!exported.ok) return { ok: false, code: 'failed', message: exported.error.message };
      const info = await this.inspectPackage(path);
      if (!info.ok) return { ok: false, code: 'failed', message: info.error.message };
      const name = backupName(info.value.work.title, new Date(), info.value.summary);
      const bytes = await readFile(path);
      const uploads = [];
      for (const [index, { provider }] of selected.entries()) {
        onUpload({ provider, current: index + 1, total: selected.length });
        uploads.push({ provider, result: await this.cloud.uploadBackup(provider, name, bytes) });
      }
      return { ok: true, uploads };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async downloadBackup({ provider, fileId }: CloudBackupFileArgs): Promise<CloudDownloadBackupResult> {
    const result = await this.cloud.downloadBackup(provider, fileId);
    if (!result.ok) return result;
    const dir = await mkdtemp(join(tmpdir(), 'chaptale-restore-'));
    const path = join(dir, 'backup.chaptale');
    try {
      await writeFile(path, result.bytes);
    } catch (cause) {
      await rm(dir, { recursive: true, force: true });
      throw cause;
    }
    this.downloads.add(path);
    return { ok: true, path };
  }

  async discardDownload(path: string): Promise<void> {
    if (this.downloads.delete(path)) await rm(dirname(path), { recursive: true, force: true });
  }
}
