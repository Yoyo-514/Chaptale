import type { WorkPackageSummary } from '@chaptale/creation/contracts';

import type { CloudBackupInfo } from '../../../bridge/cloud-sync';

/** 备份出自哪台电脑的哪份安装；电脑名只用于显示，安装 ID 区分同名电脑。 */
export type BackupDevice = { name: string; installId: string };

const two = (value: number) => String(value).padStart(2, '0');
/** 两家网盘和 Windows 都不接受的文件名字符。 */
const unsafe = /[\\/:*?"<>|]/g;

/**
 * 备份文件名：标题、本机备份时间、手动或自动、电脑名、安装 ID 前 8 位、作品 ID、条目数。
 * 恢复列表靠它按作品分组并标出来源，所以手动与自动备份用同一格式。
 */
export function backupName(
  work: { id: string; title: string },
  at: Date,
  kind: CloudBackupInfo['kind'],
  device: BackupDevice,
  { manuscripts, resources, images }: WorkPackageSummary
): string {
  const time = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}_${two(at.getHours())}${two(at.getMinutes())}`;
  return [
    work.title.replace(unsafe, '_'),
    time,
    kind,
    device.name.replace(unsafe, '_'),
    device.installId.slice(0, 8),
    work.id,
    `m${manuscripts}-r${resources}-i${images}.chaptale`
  ].join('_');
}

const pattern =
  /^(.*)_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(manual|auto)_(.+)_[0-9a-f]{8}_([0-9a-f-]{36})_m(\d+)-r(\d+)-i(\d+)(?: \(\d+\)| \d+)?\.chaptale$/;

/** 读回 `backupName` 写进去的内容；网盘给重名文件加的编号不影响识别。别的命名返回 null。 */
export function parseBackupName(name: string): CloudBackupInfo | null {
  const match = pattern.exec(name);
  if (!match) return null;
  const [, title, year, month, day, hour, minute, kind, device, workId, manuscripts, resources, images] = match;
  return {
    workId: workId!,
    title: title!,
    at: new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).toISOString(),
    kind: kind as CloudBackupInfo['kind'],
    device: device!,
    summary: { manuscripts: Number(manuscripts), resources: Number(resources), images: Number(images) }
  };
}
