import type { ChatMessage } from '@chaptale/shared';
import type { AgentRunResult, SelectedContextFile, StreamAgentHandlers, StreamAgentOptions } from './agent';
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
import type { WindowStateResult } from './window';

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
    /** 弹出保存对话框导出当前分支为 Markdown，返回保存路径；取消时返回 null。 */
    exportMarkdown: (sessionId: string) => Promise<string | null>;
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
    selectContextFiles: () => Promise<SelectedContextFile[]>;
    /** 校验拖拽进来的本地路径，返回可用的上下文文件描述（含预览）。 */
    inspectContextFiles: (paths: string[]) => Promise<SelectedContextFile[]>;
    /** 拖拽场景：把 renderer 的 File 对象转换为本地绝对路径（preload 内调用 webUtils）。 */
    getPathForFile: (file: File) => string;
    stream: (
      query: string,
      handlers: StreamAgentHandlers,
      sessionId?: string,
      options?: StreamAgentOptions
    ) => Promise<AgentRunResult>;
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
};
