import type { ChatContextFile, ChatMessage, SubagentSlotEvent, SubagentSlotSnapshot, TodoItem } from '@chaptale/shared';

import type {
  AgentQueueClearResult,
  AgentRunResult,
  SteerAgentOptions,
  StreamAgentHandlers,
  StreamAgentOptions
} from './agent';
import type { AppPlatformResult } from './app';
import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  FetchCustomProviderModelsResult,
  ListModelsResult,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  RemoveProviderAuthPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  SetProviderApiKeyPayload,
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
  UpdatePiWebAccessSettingsPayload
} from './settings';
import type { SlashCommand } from './slash-command';
import type { AgentRunsListPayload, TaskRunCompleteEvent, TaskRunPayload } from './tasks';
import type { TodosUpdatedEvent } from './todos';
import type { WindowStateResult } from './window';

/**
 * Preload 暴露给启用上下文隔离且关闭 Node 集成的 Renderer 的完整能力契约。
 * 该类型只描述可跨进程调用的稳定数据，不允许 Electron、Node 或具体 SDK 类型越过边界。
 */
export type ChaptaleDesktopApi = {
  getPlatform: () => Promise<AppPlatformResult>;
  windowControl: {
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    isMaximized: () => Promise<WindowStateResult>;
  };
  session: {
    list: () => Promise<ChaptaleSessionListItem[]>;
    create: (options?: CreateSessionOptions) => Promise<ChaptaleSessionMetadata>;
    getEntries: (sessionId: string) => Promise<ChaptaleSessionTreeEntry[]>;
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
    updateWebAccess: (payload: UpdatePiWebAccessSettingsPayload) => Promise<ChaptaleSettingsState>;
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
    setProviderApiKey: (payload: SetProviderApiKeyPayload) => Promise<ListModelsResult>;
    fetchCustomProviderModels: (payload: FetchCustomProviderModelsPayload) => Promise<FetchCustomProviderModelsResult>;
    addCustomProvider: (payload: AddCustomProviderPayload) => Promise<ListModelsResult>;
    addCustomModel: (payload: AddCustomModelPayload) => Promise<ListModelsResult>;
    setCustomProviderApiKey: (payload: SetCustomProviderApiKeyPayload) => Promise<ListModelsResult>;
    removeCustomProviderApiKey: (payload: RemoveCustomProviderApiKeyPayload) => Promise<ListModelsResult>;
    updateCustomModelInput: (payload: UpdateCustomModelInputPayload) => Promise<ListModelsResult>;
    removeCustomModel: (payload: RemoveCustomModelPayload) => Promise<ListModelsResult>;
    removeProviderAuth: (payload: RemoveProviderAuthPayload) => Promise<ListModelsResult>;
  };
  agent: {
    selectContextFiles: () => Promise<ChatContextFile[]>;
    /** 校验拖拽进来的本地路径，返回可用的上下文文件描述（含预览）。 */
    inspectContextFiles: (paths: string[]) => Promise<ChatContextFile[]>;
    /** 拖拽场景：把 renderer 的 File 对象转换为本地绝对路径（preload 内调用 webUtils）。 */
    getPathForFile: (file: File) => string;
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
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
  tasks: {
    run: (payload: TaskRunPayload) => Promise<TaskRunCompleteEvent>;
    /** 取消运行中的任务；键为发起时预生成的 requestId。 */
    cancel: (requestId: string) => Promise<void>;
    listRuns: (payload?: AgentRunsListPayload) => Promise<unknown>;
  };
  todos: {
    /** 读取指定会话的 todo 清单；无清单时返回空表。 */
    get: (sessionId: string) => Promise<TodoItem[]>;
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
  permissions: {
    /** 指定会话的待授权请求，供挂载/刷新后恢复卡片。 */
    getPending: (sessionId: string) => Promise<PermissionAskEvent[]>;
    decide: (args: PermissionDecideArgs) => Promise<PermissionDecideResult>;
    /** 列出工作区与全局两层持久规则。 */
    listRules: () => Promise<PermissionRuleEntry[]>;
    /** 删除指定持久层内所有完全相同的规则并返回最新列表。 */
    removeRule: (args: PermissionRemoveRuleArgs) => Promise<PermissionRuleEntry[]>;
    /** 订阅新授权请求；返回取消订阅函数。 */
    onAsk: (listener: (event: PermissionAskEvent) => void) => () => void;
  };
};
