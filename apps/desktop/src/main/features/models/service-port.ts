import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  FetchCustomProviderModelsResult,
  ListModelsResult,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';

/**
 * 模型与认证配置的应用层端口；隐藏持久化格式细节，调用方只面向契约操作。
 *
 * 名字带 Port 后缀是刻意的：实现是 `core/models/service.ts` 的 `ModelService` 类，
 * 同名会让「这是接口还是实现」在每个引用处都要重新判断一次。
 */
export interface ModelServicePort {
  listModels(): Promise<ListModelsResult>;
  setDefaultModel(payload: SetDefaultModelPayload): Promise<ListModelsResult>;
  fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload): Promise<FetchCustomProviderModelsResult>;
  addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult>;
  addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult>;
  setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult>;
  removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult>;
  updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult>;
  removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult>;
}
