import { AUTO_BACKUP_INTERVAL_MINUTES } from '@chaptale/ipc-contract';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatWhen(value: string): string {
  const at = new Date(value);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString() ? time : `${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

export function describeBackupInterval(minutes: number): string {
  if (minutes < 60) return `每 ${minutes} 分钟一次`;
  if (minutes % 1440 === 0) return minutes === 1440 ? '每天一次' : `每 ${minutes / 1440} 天一次`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时一次`;
  return `每 ${minutes} 分钟一次`;
}

/** 输入中的暂态值不发给 IPC；与契约的整数范围保持一致。 */
export function isValidBackupInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AUTO_BACKUP_INTERVAL_MINUTES.min &&
    value <= AUTO_BACKUP_INTERVAL_MINUTES.max
  );
}
