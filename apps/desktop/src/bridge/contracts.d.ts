import type { AgentClient } from '@chaptale/agent-host/protocol';
import type { AddFilesReport, CreationClient } from '@chaptale/creation/contracts';

import type { AppPlatformResult, EditCommand } from './app';
import type {
  CloudAuthResult,
  CloudBackupProgress,
  CloudBackupWorkArgs,
  CloudBackupWorkResult,
  CloudBackupFileArgs,
  CloudDeleteBackupResult,
  CloudDownloadBackupResult,
  CloudListBackupsResult,
  CloudProviderArgs,
  CloudSyncState
} from './cloud-sync';
import type { DataDirectoryStatus } from './data-directory';
import type { AppAboutInfo, AppUpdateCheck, AppUpdateState } from './help';
import type {
  ScheduledBackupEvent,
  ScheduledBackupPatch,
  ScheduledBackupReport,
  ScheduledBackupState
} from './scheduled-backup';
import type { ChaptaleSettingsState, UpdateChaptaleSettingsPayload } from './settings';
import type { WindowStateResult, WindowZoomCommand } from './window';

export interface DesktopAgentClient extends AgentClient {
  /** 选择要导入的技能文件夹或单个 .md 文件；取消时返回 null。 */
  selectSkillSource?(kind: 'directory' | 'file'): Promise<string | null>;
  /** 在系统文件管理器中定位已登记的技能文件，或打开技能根目录。 */
  revealSkillPath?(input: { workId: string | null; filePath: string }): Promise<void>;
  onDisconnected(listener: (message: string) => void): () => void;
}

/** 资料文件条目的平台操作；open-with 只在 Windows 可用。 */
export type FileAction = 'open' | 'open-with' | 'show-in-folder';
export interface FileTarget {
  workId: string;
  entryId: string;
}
/** 读取目标；trashed 为 true 时读取回收站中的文件，供回收站缩略图。 */
export interface FileReadTarget extends FileTarget {
  trashed: boolean;
}

export interface AddFileDataInput {
  workId: string;
  parentId: string | null;
  fileName: string;
  data: Uint8Array;
}

export interface DesktopCreationClient extends CreationClient {
  selectPaths(
    purpose: 'import-files' | 'import-directory' | 'export-directory' | 'add-files' | 'import-package'
  ): Promise<string[] | null>;
  /** 选择作品包的保存位置；取消时为 null。 */
  selectPackageSavePath(title: string): Promise<string | null>;
  fileAction(target: FileTarget, action: FileAction): Promise<void>;
  /** 读取文件条目当前内容，供应用内预览。 */
  readFile(target: FileReadTarget): Promise<Uint8Array>;
  /** 拖入的系统文件对应的本机路径；剪贴板中的截图等没有路径时为空字符串。 */
  pathForFile(file: File): string;
  /** 添加没有本机路径的文件（如粘贴的截图），按 addFiles 的规则登记为资料文件条目。 */
  addFileData(input: AddFileDataInput): Promise<AddFilesReport>;
  onDisconnected(listener: (message: string) => void): () => void;
}

/**
 * Preload 暴露给启用上下文隔离且关闭 Node 集成的 Renderer 的完整能力契约。
 * 该类型只描述可跨进程调用的稳定数据，不允许 Electron、Node 或具体 SDK 类型越过边界。
 */
export type ChaptaleDesktopApi = {
  agentHost: DesktopAgentClient;
  creation: DesktopCreationClient;
  cloudSync: {
    getState: () => Promise<CloudSyncState>;
    /** 打开系统浏览器等待回环回调；授权结束（成功/取消/超时/拒绝）才 resolve。 */
    beginAuth: (args: CloudProviderArgs) => Promise<CloudAuthResult>;
    cancelAuth: () => Promise<void>;
    /** 只清除本机凭据，不调用服务商撤销接口。 */
    signOut: (args: CloudProviderArgs) => Promise<CloudSyncState>;
    backupWork: (
      args: CloudBackupWorkArgs,
      onUpload: (progress: CloudBackupProgress) => void
    ) => Promise<CloudBackupWorkResult>;
    listBackups: (args: CloudProviderArgs) => Promise<CloudListBackupsResult>;
    downloadBackup: (args: CloudBackupFileArgs) => Promise<CloudDownloadBackupResult>;
    deleteBackup: (args: CloudBackupFileArgs) => Promise<CloudDeleteBackupResult>;
    discardDownload: (path: string) => Promise<void>;
  };
  getPlatform: () => Promise<AppPlatformResult>;
  editCommand: (command: EditCommand) => Promise<void>;
  help: {
    getAbout: () => Promise<AppAboutInfo>;
    reportIssue: () => Promise<void>;
    getUpdateState: () => Promise<AppUpdateState>;
    checkUpdate: () => Promise<AppUpdateCheck>;
  };
  windowControl: {
    zoom: (command: WindowZoomCommand) => Promise<number>;
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    completeClose: (close: boolean) => Promise<void>;
    onCloseRequested: (listener: () => void) => () => void;
    isMaximized: () => Promise<WindowStateResult>;
  };
  dataDirectory: {
    status: () => Promise<DataDirectoryStatus>;
    open: () => Promise<void>;
    /** 打开系统文件夹选择框；取消时为 null，不保存。 */
    select: () => Promise<string | null>;
    /** 校验并保存数据目录；文件夹不符合要求时报错。 */
    choose: (path: string) => Promise<DataDirectoryStatus>;
  };
  scheduledBackup: {
    getState: () => Promise<ScheduledBackupState>;
    update: (patch: ScheduledBackupPatch) => Promise<ScheduledBackupState>;
    chooseDirectory: () => Promise<ScheduledBackupState>;
    openDirectory: () => Promise<void>;
    /** 定时备份关着也能用；还没选文件夹时先选，取消返回 null。不会打开定时备份。 */
    backupNow: () => Promise<ScheduledBackupReport | null>;
    /** 在备份文件夹里选一个作品包，取消返回 null。 */
    pickBackup: () => Promise<string | null>;
    subscribe: (listener: (event: ScheduledBackupEvent) => void) => () => void;
  };
  settings: {
    getState: () => Promise<ChaptaleSettingsState>;
    update: (payload: UpdateChaptaleSettingsPayload) => Promise<ChaptaleSettingsState>;
    openConfigDir: () => Promise<void>;
  };
};
