import type {
  CloudBackupArchive,
  CloudBackupFailure,
  CloudBackupProgress,
  CloudBinding,
  CloudProvider,
  CloudQuota,
  CloudRemoteFolder,
  CloudRestoreChoice,
  CloudRestoreDiffResult,
  CloudRestoreMode,
  CloudRestorePlan,
  CloudRestoreResult,
  CloudSyncState
} from '@chaptale/ipc-contract';

type CloudFolderListing = {
  current: CloudRemoteFolder;
  parentId: string | null;
  folders: CloudRemoteFolder[];
};

export type CloudWorkspaceScope = { rootPath: string | null; revision: number };

export type RestoreWizardState = {
  archiveId: string;
  archiveName: string;
  plan: CloudRestorePlan;
  mode: CloudRestoreMode;
  choices: Record<string, CloudRestoreChoice>;
  diff: (CloudRestoreDiffResult & { ok: true; relativePath: string }) | null;
  receipt: (CloudRestoreResult & { ok: true }) | null;
  workspace: CloudWorkspaceScope;
};

export type CloudSyncStoreState = {
  state: CloudSyncState | null;
  isLoading: boolean;
  error: string;
  busy: CloudProvider | null;
  browseProvider: CloudProvider | null;
  listing: CloudFolderListing | null;
  isListingLoading: boolean;
  listingError: string;
  folderRequest: number;
  workspaceScope: CloudWorkspaceScope | null;
  bindingRequest: number;
  backupRequest: number;
  binding: CloudBinding | null;
  bindingError: string;
  lastBackupAt: string;
  lastBackupError: CloudBackupFailure | null;
  archives: CloudBackupArchive[];
  quota: CloudQuota | null;
  isBackupLoading: boolean;
  backupError: string;
  progress: CloudBackupProgress | null;
  isBackupRunning: boolean;
  notice: string;
  wizard: RestoreWizardState | null;
  isPlanLoading: boolean;
  isApplying: boolean;
  restoreRequest: number;
  diffRequest: number;
};

/** action 分片只依赖实际跨分片调用的能力，不反向导入 Pinia 实例类型。 */
export type CloudSyncStoreContext = CloudSyncStoreState & {
  readonly restoreBlockedReason: string;
  load(): Promise<void>;
  openFolder(provider: CloudProvider, parentId: string | null): Promise<void>;
  closeFolder(): void;
  syncWorkspace(): CloudWorkspaceScope;
  loadBinding(): Promise<void>;
  loadBackups(): Promise<void>;
  refreshCloud(): Promise<void>;
  refreshRestoredTabs(paths: string[]): Promise<void>;
};
