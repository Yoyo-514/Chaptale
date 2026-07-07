import type {
  ChaptaleSettingsState,
  FetchedCustomProviderModel,
  ListModelsResult,
  UpdateChaptaleSettingsPayload,
  UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';

export type SettingsSection = 'workspace' | 'llm' | 'webAccess' | 'files';

export type SettingsStoreState = {
  state: ChaptaleSettingsState | undefined;
  models: ListModelsResult | undefined;
  activeSection: SettingsSection;
  isOpen: boolean;
  isLoading: boolean;
  isModelsLoading: boolean;
  isFetchingCustomModels: boolean;
  fetchedCustomModels: FetchedCustomProviderModel[];
  error: string;
};

export type SettingsStoreContext = SettingsStoreState & {
  runAction<T>(title: string, action: () => Promise<T>): Promise<T | undefined>;
  runModelsAction(title: string, action: () => Promise<ListModelsResult>): Promise<boolean>;
  load(): Promise<void>;
  loadModels(): Promise<void>;
  update(payload: UpdateChaptaleSettingsPayload): Promise<void>;
  updateWebAccess(payload: UpdatePiWebAccessSettingsPayload): Promise<void>;
};
