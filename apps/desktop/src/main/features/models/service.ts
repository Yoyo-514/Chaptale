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
} from '@chaptale/ipc-contract';

/** 模型与认证配置的应用层端口；隐藏 Pi 上游及其持久化格式，调用方不直接依赖 Pi。 */
export interface ModelService {
  listModels(): Promise<ListModelsResult>;
  setDefaultModel(payload: SetDefaultModelPayload): Promise<ListModelsResult>;
  setProviderApiKey(payload: SetProviderApiKeyPayload): Promise<ListModelsResult>;
  fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload): Promise<FetchCustomProviderModelsResult>;
  addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult>;
  addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult>;
  setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult>;
  removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult>;
  updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult>;
  removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult>;
  removeProviderAuth(payload: RemoveProviderAuthPayload): Promise<ListModelsResult>;
}
