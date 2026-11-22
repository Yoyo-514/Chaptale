export const SCHEDULED_BACKUP_INTERVALS = [10, 30, 60] as const;
export type ScheduledBackupInterval = (typeof SCHEDULED_BACKUP_INTERVALS)[number];

export type ScheduledBackupSettings = {
  enabled: boolean;
  directory: string | null;
  intervalMinutes: ScheduledBackupInterval;
};

export const DEFAULT_SCHEDULED_BACKUP: Readonly<ScheduledBackupSettings> = {
  enabled: false,
  directory: null,
  intervalMinutes: 30
};

export type ScheduledBackupPatch = Partial<Pick<ScheduledBackupSettings, 'enabled' | 'intervalMinutes'>>;

export type ScheduledBackupState = {
  settings: ScheduledBackupSettings;
  /** 该文件夹最近一次保存本机作品包的时间（毫秒）。 */
  lastBackupAt: number | null;
  folderError: string | null;
  /** 尚未恢复的失败：本机一项，每个云端账户各一项。 */
  failures: ScheduledBackupFailure[];
};

export type ScheduledBackupFailure = { title: string; message: string };
/** 一轮检查的结果：本机新存了几部作品，以及这一轮之后仍未恢复的失败。 */
export type ScheduledBackupReport = { saved: number; failures: ScheduledBackupFailure[] };
export type ScheduledBackupEvent = { kind: 'changed' } | ({ kind: 'failed' } & ScheduledBackupFailure);
