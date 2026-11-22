import { join } from 'node:path';

import type { BackupDevice } from '../cloud-sync/package-name';
import type { CloudSyncService } from '../cloud-sync/service';
import type { CloudBackupAccount } from '../cloud-sync/store';
import { AUTO_BACKUP_LIMIT, ownAutoBackup } from './local';

type Receipt = { name: string; needsPruning?: true };
export type BackupReceipts = Record<string, Receipt>;

type RemoteBackup = { id: string; name: string; at: string; modifiedAt?: string };

/** 只处理比回执更新的本机包。回执先于删除旧包保存，清理失败只重试清理。 */
export async function syncBackupAccount({
  cloud,
  account,
  directory,
  device,
  latest,
  receipts,
  saveProgress,
  signal
}: {
  cloud: CloudSyncService;
  account: CloudBackupAccount;
  directory: string;
  device: BackupDevice;
  latest: ReadonlyMap<string, string>;
  receipts: BackupReceipts;
  saveProgress: () => Promise<void>;
  signal: AbortSignal;
}): Promise<{ failure: string | null } | null> {
  const pending = [...latest].filter(([workId, name]) => {
    const receipt = receipts[workId];
    return receipt?.name !== name || receipt.needsPruning;
  });
  if (signal.aborted || !pending.length) return null;

  const listing = await cloud.listBackups(account, signal);
  if (!listing.ok) {
    return signal.aborted || listing.code === 'not-signed-in' ? null : { failure: listing.message };
  }
  const remote = new Map<string, RemoteBackup[]>();
  for (const entry of listing.backups) {
    const info = ownAutoBackup(entry.name, device);
    if (!info) continue;
    const backups = remote.get(info.workId) ?? [];
    backups.push({ ...entry, at: info.at });
    remote.set(info.workId, backups);
  }

  let failure: string | null = null;
  for (const [workId, name] of pending) {
    if (signal.aborted) return null;
    const backups = remote.get(workId) ?? [];
    let receipt = receipts[workId];
    if (receipt?.name !== name) {
      // 退出或断线可能发生在云端写完之后、收到回执之前。找到原来的包时直接补记回执。
      if (!backups.some(entry => entry.name === name)) {
        const uploaded = await cloud.uploadBackup(account, name, join(directory, name), signal);
        if (!uploaded.ok) {
          if (signal.aborted || uploaded.code === 'not-signed-in') return null;
          failure ??= uploaded.message;
          continue;
        }
        const info = ownAutoBackup(uploaded.entry.name, device);
        if (info) backups.push({ ...uploaded.entry, at: info.at });
      }
      receipt = { name, ...(backups.length > AUTO_BACKUP_LIMIT && { needsPruning: true }) };
      receipts[workId] = receipt;
      await saveProgress();
    }
    if (!receipt.needsPruning) continue;
    // 文件名只精确到分钟，同一分钟的两份再按云端写入时间排。
    backups.sort((a, b) => b.at.localeCompare(a.at) || (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''));
    let pruned = true;
    for (const old of backups.slice(AUTO_BACKUP_LIMIT)) {
      if (signal.aborted) return null;
      const removed = await cloud.deleteBackup(account, old.id, signal);
      if (!removed.ok) {
        if (signal.aborted || removed.code === 'not-signed-in') return null;
        failure ??= removed.message;
        pruned = false;
        break;
      }
    }
    if (pruned) {
      delete receipt.needsPruning;
      await saveProgress();
    }
  }
  return { failure };
}
