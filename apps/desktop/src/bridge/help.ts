export type AppAboutInfo = {
  version: string;
  /** 只含应用版本和系统信息；用于复制及反馈问题。 */
  versionText: string;
};

export type AppRelease = {
  version: string;
  notes: string;
};

export type AppUpdate = AppRelease & { downloadUrl: string };

export type AppUpdateState = {
  checkOnStartup: boolean;
  available: AppUpdate | null;
};

export type AppUpdateCheck =
  | { kind: 'available'; update: AppUpdate; announce: boolean }
  | { kind: 'current'; version: string }
  | { kind: 'unpublished' };
