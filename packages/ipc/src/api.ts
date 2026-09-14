import type {
  ChatContextFile,
  ChatMessage,
  MemoryCompactionResult,
  MemoryContextPressureStatus,
  MemoryPendingAction,
  MemoryPendingDetails,
  MemoryPendingListResult,
  MemoryPendingResolveResult,
  SubagentSlotEvent,
  SubagentSlotSnapshot,
  TodoItem
} from '@chaptale/shared';

import type {
  AgentQueueClearResult,
  AgentRunResult,
  SteerAgentOptions,
  StreamAgentHandlers,
  StreamAgentOptions
} from './agent';
import type { AppPlatformResult, EditCommand } from './app';
import type {
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
  CloudSyncState
} from './cloud-sync';
import type { ContentApi } from './content';
import type { LibraryApi } from './library';
import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  FetchCustomProviderModelsResult,
  ListModelsResult,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  RemoveCustomProviderPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  UpdateCustomModelInputPayload
} from './models';
import type {
  PermissionAskEvent,
  PermissionDecideArgs,
  PermissionDecideResult,
  PermissionRemoveRuleArgs,
  PermissionRuleEntry
} from './permissions';
import type { PromptSettingsState, UpdatePromptSettingsPayload } from './prompt-settings';
import type { ReviewsApi } from './reviews';
import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions,
  ReadSessionImagePayload,
  ReadSessionImageResult
} from './session';
import type {
  ChaptaleSettingsState,
  SelectWorkspaceDirResult,
  UpdateChaptaleSettingsPayload,
  UpdateWebToolsSettingsPayload
} from './settings';
import type { SettlementApi } from './settlement';
import type { SlashCommand } from './slash-command';
import type {
  AgentRunsListPayload,
  AgentRunsListResult,
  TaskReadRunOutputResult,
  TaskRunCompleteEvent,
  TaskRunPayload
} from './tasks';
import type { TemplatesApi } from './templates';
import type { TodosClearPayload, TodosUpdatedEvent } from './todos';
import type { WindowStateResult } from './window';
import type {
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
} from './workspace';
import type { WritingApi } from './writing';

/**
 * Preload 暴露给启用上下文隔离且关闭 Node 集成的 Renderer 的完整能力契约。
 * 该类型只描述可跨进程调用的稳定数据，不允许 Electron、Node 或具体 SDK 类型越过边界。
 */
export type ChaptaleDesktopApi = {
  content: ContentApi;
  settlement: SettlementApi;
  writing: WritingApi;
  templates: TemplatesApi;
  reviews: ReviewsApi;
  library: LibraryApi;
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
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    completeClose: (close: boolean) => Promise<void>;
    onCloseRequested: (listener: () => void) => () => void;
    isMaximized: () => Promise<WindowStateResult>;
  };
  session: {
    list: () => Promise<ChaptaleSessionListItem[]>;
    create: (options?: CreateSessionOptions) => Promise<ChaptaleSessionMetadata>;
    /** 全量会话树（含当前分支之外的兄弟子树）；当前分支由调用方沿 parentId 从 leafId 回溯。 */
    getEntries: (sessionId: string) => Promise<ChaptaleSessionTreeEntry[]>;
    /** 当前分支的消息投影。 */
    getMessages: (sessionId: string) => Promise<ChatMessage[]>;
    readImage: (payload: ReadSessionImagePayload) => Promise<ReadSessionImageResult>;
    rename: (sessionId: string, name: string) => Promise<ChaptaleSessionInfoEntry>;
    /** 弹出保存对话框导出当前分支为单文件 HTML，返回保存路径；取消时返回 null。 */
    exportHtml: (sessionId: string) => Promise<string | null>;
    delete: (sessionId: string) => Promise<void>;
    deleteMany: (sessionIds: string[]) => Promise<void>;
    setLeaf: (sessionId: string, leafId: string | null) => Promise<void>;
    getStorageDebugInfo: () => Promise<ChaptaleSessionStorageDebugInfo>;
    openStorageDir: () => Promise<void>;
  };
  settings: {
    getState: () => Promise<ChaptaleSettingsState>;
    update: (payload: UpdateChaptaleSettingsPayload) => Promise<ChaptaleSettingsState>;
    updateWebTools: (payload: UpdateWebToolsSettingsPayload) => Promise<ChaptaleSettingsState>;
    selectWorkspaceDir: () => Promise<SelectWorkspaceDirResult>;
    openConfigDir: () => Promise<void>;
  };
  promptSettings: {
    getState: () => Promise<PromptSettingsState>;
    update: (payload: UpdatePromptSettingsPayload) => Promise<PromptSettingsState>;
  };
  slashCommands: {
    list: () => Promise<SlashCommand[]>;
  };
  models: {
    list: () => Promise<ListModelsResult>;
    setDefault: (payload: SetDefaultModelPayload) => Promise<ListModelsResult>;
    fetchCustomProviderModels: (payload: FetchCustomProviderModelsPayload) => Promise<FetchCustomProviderModelsResult>;
    addCustomProvider: (payload: AddCustomProviderPayload) => Promise<ListModelsResult>;
    addCustomModel: (payload: AddCustomModelPayload) => Promise<ListModelsResult>;
    setCustomProviderApiKey: (payload: SetCustomProviderApiKeyPayload) => Promise<ListModelsResult>;
    removeCustomProviderApiKey: (payload: RemoveCustomProviderApiKeyPayload) => Promise<ListModelsResult>;
    removeCustomProvider: (payload: RemoveCustomProviderPayload) => Promise<ListModelsResult>;
    updateCustomModelInput: (payload: UpdateCustomModelInputPayload) => Promise<ListModelsResult>;
    removeCustomModel: (payload: RemoveCustomModelPayload) => Promise<ListModelsResult>;
  };
  agent: {
    selectContextFiles: () => Promise<ChatContextFile[]>;
    /** 校验拖拽进来的本地路径，返回可用的上下文文件描述（含预览）。 */
    inspectContextFiles: (paths: string[]) => Promise<ChatContextFile[]>;
    /** 拖拽场景：把 renderer 的 File 对象转换为本地绝对路径（preload 内调用 webUtils）。 */
    getPathForFile: (file: File) => string;
    /** 启动流式运行；completed/cancelled/failed 均只经 handlers.onEnd 回传。 */
    stream: (
      query: string,
      handlers: StreamAgentHandlers,
      sessionId?: string,
      options?: StreamAgentOptions
    ) => Promise<AgentRunResult>;
    /** 向指定活跃运行追加一条 steer。 */
    steer: (runId: string, query: string, options?: SteerAgentOptions) => Promise<AgentRunResult>;
    /** 清空指定活跃运行尚未消费的消息。 */
    clearPendingMessages: (runId: string) => Promise<AgentQueueClearResult>;
    /** 查询当前会话上下文水位及是否达到作者提示阈值。 */
    getContextPressure: (sessionId: string) => Promise<MemoryContextPressureStatus>;
    /** 作者确认后压缩会话；运行中调用会被主进程拒绝。 */
    compactSession: (sessionId: string) => Promise<MemoryCompactionResult>;
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
  tasks: {
    run: (payload: TaskRunPayload) => Promise<TaskRunCompleteEvent>;
    /** 取消运行中的任务；键为发起时预生成的 requestId。 */
    cancel: (requestId: string) => Promise<void>;
    listRuns: (payload?: AgentRunsListPayload) => Promise<AgentRunsListResult>;
    /** 按 outputRef 读取落盘的运行输出；引用非法或不存在时返回 null。 */
    readRunOutput: (outputRef: string) => Promise<TaskReadRunOutputResult | null>;
  };
  todos: {
    /** 读取指定会话的 todo 清单；无清单时返回空表。 */
    get: (sessionId: string) => Promise<TodoItem[]>;
    /** 用户手动清理：scope=all 清空整表；scope=completed 只移除已完成项。返回清理后的新表。 */
    clear: (payload: TodosClearPayload) => Promise<TodoItem[]>;
    /** 订阅清单变更（整表推送）；返回取消订阅函数。 */
    onUpdated: (listener: (event: TodosUpdatedEvent) => void) => () => void;
  };
  subagent: {
    /** 指定会话的活跃子任务快照，供挂载/刷新后恢复卡片。 */
    listActive: (sessionId: string) => Promise<SubagentSlotSnapshot[]>;
    /** 取消子任务；排队中直接出队，运行中立即终结。 */
    cancel: (requestId: string) => Promise<void>;
    /** 订阅槽位状态机事件；返回取消订阅函数。 */
    onEvent: (listener: (event: SubagentSlotEvent) => void) => () => void;
  };
  memory: {
    /** 当前作品的待确认提议列表（含坏文件诊断）。 */
    listPending: () => Promise<MemoryPendingListResult>;
    /** 接受或拒绝提议；冲突时提议保留并返回原因。 */
    inspectPending: (args: { id: string; rootPath?: string }) => Promise<MemoryPendingDetails>;
    resolvePending: (args: {
      id: string;
      action: MemoryPendingAction;
      rootPath?: string;
      expectedProposalHash?: string;
    }) => Promise<MemoryPendingResolveResult>;
    /** 订阅 pending 集合变更（新提议/已处理）；返回取消订阅函数。 */
    onPendingChanged: (listener: () => void) => () => void;
  };
  permissions: {
    /** 指定会话的待授权请求，供挂载/刷新后恢复卡片。 */
    getPending: (sessionId: string) => Promise<PermissionAskEvent[]>;
    decide: (args: PermissionDecideArgs) => Promise<PermissionDecideResult>;
    /** 列出作品与全局两层持久规则。 */
    listRules: () => Promise<PermissionRuleEntry[]>;
    /** 删除指定持久层内所有完全相同的规则并返回最新列表。 */
    removeRule: (args: PermissionRemoveRuleArgs) => Promise<PermissionRuleEntry[]>;
    /** 订阅新授权请求；返回取消订阅函数。 */
    onAsk: (listener: (event: PermissionAskEvent) => void) => () => void;
  };
};
