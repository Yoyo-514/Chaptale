import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { writeBytesAtomically } from '../../../infra/filesystem/atomic-bytes';
import type { CloudCredential, CloudProviderAdapter } from '../providers/provider-port';

/**
 * 恢复向导共用一次下载；键包含来源与作品，不能只凭服务商局部的文件 ID 复用。
 * 调用方持有云操作锁，clear 不会与正在读写的恢复交错。
 */
export class RestoreArchiveCache {
  private key: string | null = null;
  private readonly directory: string;
  private readonly filename: string;

  constructor(cacheRoot: string) {
    this.directory = path.join(cacheRoot, 'cloud-restore');
    this.filename = path.join(this.directory, 'pending.zip');
  }

  async ensure(
    target: { adapter: CloudProviderAdapter; credential: CloudCredential; rootPath: string; folderId: string },
    archiveId: string
  ): Promise<string> {
    const key = JSON.stringify([target.adapter.id, target.rootPath, target.folderId, archiveId]);
    if (this.key === key && (await stat(this.filename).catch(() => null))?.isFile()) return this.filename;
    const bytes = await target.adapter.download({ credential: target.credential, fileId: archiveId });
    await mkdir(this.directory, { recursive: true });
    await writeBytesAtomically(this.filename, bytes);
    this.key = key;
    return this.filename;
  }

  async clear(): Promise<void> {
    this.key = null;
    await rm(this.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
