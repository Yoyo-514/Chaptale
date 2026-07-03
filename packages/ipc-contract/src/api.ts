import type { ChatMessage } from '@chaptale/shared';
import type { AgentRunResult, StreamAgentHandlers } from './agent';
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
  CreateSessionOptions
} from './session';
import type { ChaptaleSettingsState, SelectWorkspaceDirResult, UpdateChaptaleSettingsPayload } from './settings';
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
    rename: (sessionId: string, name: string) => Promise<ChaptaleSessionInfoEntry>;
    delete: (sessionId: string) => Promise<void>;
    setLeaf: (sessionId: string, leafId: string | null) => Promise<void>;
    getStorageDebugInfo: () => Promise<ChaptaleSessionStorageDebugInfo>;
    openStorageDir: () => Promise<void>;
  };
  settings: {
    getState: () => Promise<ChaptaleSettingsState>;
    update: (payload: UpdateChaptaleSettingsPayload) => Promise<ChaptaleSettingsState>;
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
    getHistory: (sessionId?: string) => Promise<ChatMessage[]>;
    stream: (query: string, handlers: StreamAgentHandlers, sessionId?: string) => Promise<AgentRunResult>;
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
};
