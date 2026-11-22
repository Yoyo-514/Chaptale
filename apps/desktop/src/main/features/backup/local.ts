import { mkdtemp, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import type { CreationClient, CreationResult } from '@chaptale/creation/contracts';

import { backupName, parseBackupName, type BackupDevice } from '../cloud-sync/package-name';

export const AUTO_BACKUP_LIMIT = 10;

/** 备份与作品分开存放，数据文件夹被删除或损坏时备份仍在。 */
export async function assertBackupDirectory(directory: string, dataDirectory: string): Promise<void> {
  const [target, data] = await Promise.all([realpath(directory), realpath(dataDirectory)]);
  const inside = relative(data, target);
  if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`)) {
    throw new Error('备份文件夹不能放在应用数据文件夹里：数据文件夹被删除或损坏时，备份会一起丢失。请另选位置。');
  }
}

export function ownAutoBackup(name: string, device: BackupDevice) {
  const parsed = parseBackupName(name);
  return parsed?.kind === 'auto' && parsed.installIdPrefix === device.installId.slice(0, 8) ? parsed : null;
}

export type LocalBackup = { name: string; modifiedAt: number };

export async function scanLocalBackups(directory: string, device: BackupDevice) {
  const byWork = new Map<string, LocalBackup[]>();
  const names = new Set<string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    names.add(entry.name.toLowerCase());
    const info = entry.isFile() && ownAutoBackup(entry.name, device);
    if (!info) continue;
    const { mtimeMs } = await stat(join(directory, entry.name));
    const backups = byWork.get(info.workId) ?? [];
    backups.push({ name: entry.name, modifiedAt: mtimeMs });
    byWork.set(info.workId, backups);
  }
  for (const backups of byWork.values()) {
    backups.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name, 'zh-CN', { numeric: true }));
  }
  return { byWork, names };
}

export function packageValue<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 在目标盘临时目录里导出；名字和内容都齐备后才把包移入备份目录。 */
export async function saveLocalBackup(
  creation: Pick<CreationClient, 'request'>,
  workId: string,
  directory: string,
  device: BackupDevice,
  names: Set<string>
): Promise<LocalBackup> {
  const staging = await mkdtemp(join(directory, '.chaptale-backup-'));
  try {
    const path = join(staging, 'work.chaptale');
    packageValue(await creation.request('exportWorkPackage', { workId, path }));
    const { work, summary } = packageValue(await creation.request('inspectWorkPackage', { path }));
    const base = backupName(work, new Date(), 'auto', device, summary);
    const stem = base.slice(0, -'.chaptale'.length);
    let name = base;
    // 开启与退出可以落在同一分钟；保留较早的一份，也给补传记录一个新名字。
    for (let index = 1; names.has(name.toLowerCase()); index++) name = `${stem} (${index}).chaptale`;
    const { mtimeMs } = await stat(path);
    await rename(path, join(directory, name));
    names.add(name.toLowerCase());
    return { name, modifiedAt: mtimeMs };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
