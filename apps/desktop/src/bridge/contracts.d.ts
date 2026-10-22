import type { AgentClient } from '@chaptale/agent-host/protocol';
import type { CreationClient } from '@chaptale/creation/contracts';
import type {
  AppPlatformResult,
  EditCommand,
  CloudArchiveArgs,
  CloudArchiveListArgs,
  CloudAuthResult,
  CloudBackupListResult,
  CloudBackupProgress,
  CloudBackupResult,
  CloudBindArgs,
  CloudBindingResult,
  CloudListFoldersArgs,
  CloudListFoldersResult,
  CloudOperationResult,
  CloudProviderArgs,
  CloudRemovalResult,
  CloudRestoreArgs,
  CloudRestoreDiffArgs,
  CloudRestoreDiffResult,
  CloudRestorePlanResult,
  CloudRestoreResult,
  CloudSyncState,
  ChaptaleSettingsState,
  SelectWorkspaceDirResult,
  UpdateChaptaleSettingsPayload,
  WindowStateResult,
  WindowZoomCommand,
  WorkspaceState,
  SelectDirectoryArgs,
  ListDirectoryArgs,
  ListDirectoryResult,
  CreateEntryArgs,
  CreateEntryResult,
  CreateWorkspaceArgs,
  CreateWorkspaceResult,
  EntryPathArgs,
  InspectEntryResult,
  MutateEntryArgs,
  MutateEntryResult,
  ReadDocumentArgs,
  ReadDocumentResult,
  WriteDocumentArgs,
  WriteDocumentResult,
  WorkspaceLayoutResult,
  CreateChapterArgs,
  WorkspaceChanged,
  RecoveryPathArgs,
  SaveRecoveryArgs,
  RecoveryDraft,
  RecoverySummary
} from '@chaptale/ipc-contract';

export interface DesktopAgentClient extends AgentClient {
  onDisconnected(listener: (message: string) => void): () => void;
}

export interface DesktopCreationClient extends CreationClient {
  selectPaths(purpose: 'import-files' | 'import-directory' | 'export-directory'): Promise<string[] | null>;
  onDisconnected(listener: (message: string) => void): () => void;
}

/**
 * Preload 暴露给启用上下文隔离且关闭 Node 集成的 Renderer 的完整能力契约。
 * 该类型只描述可跨进程调用的稳定数据，不允许 Electron、Node 或具体 SDK 类型越过边界。
 */
export type ChaptaleDesktopApi = {
  agentHost: DesktopAgentClient;
  creation: DesktopCreationClient;
  workspace: {
    getState: () => Promise<WorkspaceState>;
    selectParent: (args?: SelectDirectoryArgs) => Promise<string | null>;
    createWorkspace: (args: CreateWorkspaceArgs) => Promise<CreateWorkspaceResult>;
    inspectEntry: (args: EntryPathArgs) => Promise<InspectEntryResult>;
    mutateEntry: (args: MutateEntryArgs) => Promise<MutateEntryResult>;
    revealEntry: (args: EntryPathArgs) => Promise<void>;
    listDirectory: (args: ListDirectoryArgs) => Promise<ListDirectoryResult>;
    createEntry: (args: CreateEntryArgs) => Promise<CreateEntryResult>;
    readDocument: (args: ReadDocumentArgs) => Promise<ReadDocumentResult>;
    writeDocument: (args: WriteDocumentArgs) => Promise<WriteDocumentResult>;
    getLayout: (args: { rootPath: string }) => Promise<WorkspaceLayoutResult>;
    createChapter: (args: CreateChapterArgs) => Promise<ReadDocumentResult>;
    onChanged: (listener: (event: WorkspaceChanged) => void) => () => void;
    listRecoveries: (args: { rootPath: string }) => Promise<RecoverySummary[]>;
    readRecovery: (args: RecoveryPathArgs) => Promise<RecoveryDraft | null>;
    saveRecovery: (args: SaveRecoveryArgs) => Promise<void>;
    discardRecovery: (args: RecoveryPathArgs) => Promise<void>;
  };
  cloudSync: {
    getState: () => Promise<CloudSyncState>;
    /** 当前作品的云端绑定；**只读本机状态，不碰网络**，状态栏每次换作品都要问一次。 */
    getBinding: () => Promise<CloudBindingResult>;
    /** 打开系统浏览器等待回环回调；授权结束（成功/取消/超时/拒绝）才 resolve。 */
    beginAuth: (args: CloudProviderArgs) => Promise<CloudAuthResult>;
    cancelAuth: () => Promise<void>;
    /** 只清除本机凭据，不调用服务商撤销接口。 */
    signOut: (args: CloudProviderArgs) => Promise<CloudSyncState>;
    listFolders: (args: CloudListFoldersArgs) => Promise<CloudListFoldersResult>;
    /** 把当前作品绑到某个云端目录；最顶层且非 App Folder 接入时会建容器目录。 */
    bind: (args: CloudBindArgs) => Promise<CloudBindingResult>;
    unbind: () => Promise<CloudOperationResult>;
    /** 清单与绑定状态、配额一次带回；未绑定时返回 `no-binding`。 */
    listBackups: () => Promise<CloudBackupListResult>;
    createBackup: () => Promise<CloudBackupResult>;
    /** 算出这次恢复会动哪些文件：三种模式共用同一份比对结论。不写任何文件。 */
    planRestore: (args: CloudArchiveArgs) => Promise<CloudRestorePlanResult>;
    /** 读一个冲突项的两侧正文；非文本文件只回“二进制不同”与字节数。 */
    readRestoreDiff: (args: CloudRestoreDiffArgs) => Promise<CloudRestoreDiffResult>;
    /**
     * 执行恢复。
     *
     * `overwrite` / `merge` 会先做还原前快照（快照失败则不执行），
     * 返回本次真正写下的路径清单供渲染侧重载 tab。
     */
    applyRestore: (args: CloudRestoreArgs) => Promise<CloudRestoreResult>;
    /** 放弃这次恢复：删掉已下载的待用归档，不动作品目录。 */
    cancelRestore: () => Promise<CloudOperationResult>;
    /** 从云端删除选中的归档；**只由作者的显式确认触发**，没有任何自动路径会调用。 */
    removeBackups: (args: CloudArchiveListArgs) => Promise<CloudRemovalResult>;
    onBackupProgress: (listener: (progress: CloudBackupProgress) => void) => () => void;
  };
  getPlatform: () => Promise<AppPlatformResult>;
  editCommand: (command: EditCommand) => Promise<void>;
  windowControl: {
    zoom: (command: WindowZoomCommand) => Promise<number>;
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    completeClose: (close: boolean) => Promise<void>;
    onCloseRequested: (listener: () => void) => () => void;
    isMaximized: () => Promise<WindowStateResult>;
  };
  settings: {
    getState: () => Promise<ChaptaleSettingsState>;
    update: (payload: UpdateChaptaleSettingsPayload) => Promise<ChaptaleSettingsState>;
    selectWorkspaceDir: () => Promise<SelectWorkspaceDirResult>;
    openConfigDir: () => Promise<void>;
  };
};
