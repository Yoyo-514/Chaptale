import type {
  ChaptaleSettingsState,
  FetchedCustomProviderModel,
  ListModelsResult,
  PromptSettingsState,
  UpdateChaptaleSettingsPayload,
  UpdatePromptSettingsPayload,
  UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';

export type SettingsSection = 'workspace' | 'llm' | 'prompt' | 'webAccess' | 'files';

export type SettingsStoreState = {
  state: ChaptaleSettingsState | undefined;
  models: ListModelsResult | undefined;
  promptSettings: PromptSettingsState | undefined;
  activeSection: SettingsSection;
  isOpen: boolean;
  isLoading: boolean;
  isPromptLoading: boolean;
  isModelsLoading: boolean;
  isFetchingCustomModels: boolean;
  fetchedCustomModels: FetchedCustomProviderModel[];
  error: string;
};

/** action 分片共享的 this 契约；只列出跨分片调用能力，避免各模块反向依赖具体 Pinia store 类型。 */
export type SettingsStoreContext = SettingsStoreState & {
  runAction<T>(title: string, action: () => Promise<T>): Promise<T | undefined>;
  runModelsAction(title: string, action: () => Promise<ListModelsResult>): Promise<boolean>;
  load(): Promise<void>;
  loadModels(): Promise<void>;
  loadPromptSettings(): Promise<void>;
  updatePromptSettings(payload: UpdatePromptSettingsPayload): Promise<boolean>;
  update(payload: UpdateChaptaleSettingsPayload): Promise<void>;
  updateWebAccess(payload: UpdatePiWebAccessSettingsPayload): Promise<void>;
};
