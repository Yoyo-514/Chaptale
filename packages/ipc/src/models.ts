import type { Static } from 'typebox';

import type {
  AddCustomModelPayloadSchema,
  AddCustomProviderModelPayloadSchema,
  AddCustomProviderPayloadSchema,
  ChaptaleCustomProviderApiSchema,
  ChaptaleModelInputSchema,
  FetchCustomProviderModelsPayloadSchema,
  RemoveCustomModelPayloadSchema,
  RemoveCustomProviderApiKeyPayloadSchema,
  SetCustomProviderApiKeyPayloadSchema,
  SetDefaultModelPayloadSchema,
  UpdateCustomModelInputPayloadSchema
} from './schemas/models';

export type ChaptaleModelInput = Static<typeof ChaptaleModelInputSchema>;

export type ChaptaleCustomProviderApi = Static<typeof ChaptaleCustomProviderApiSchema>;

/** 设置页展示的模型快照，合并了 SDK 元数据、自定义来源、认证状态与默认选择。 */
export type ChaptaleModelInfo = {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: ChaptaleModelInput[];
  contextWindow: number;
  /** 单次回复最大输出 tokens。 */
  maxTokens?: number;
  /** 采样温度（0–2）。 */
  temperature?: number;
  /** 核采样阈值（0–1）。 */
  topP?: number;
  isCustom: boolean;
  authConfigured: boolean;
  isDefault: boolean;
};

/** 按供应商聚合的认证与模型数量摘要；无模型的自定义供应商也可能出现。 */
export type ChaptaleProviderInfo = {
  provider: string;
  providerName: string;
  authConfigured: boolean;
  authSource?: string;
  modelCount: number;
};

/** Renderer 刷新模型设置所需的完整一致性快照。 */
export type ListModelsResult = {
  models: ChaptaleModelInfo[];
  providers: ChaptaleProviderInfo[];
  defaultModel?: {
    provider: string;
    modelId: string;
  };
};

export type SetDefaultModelPayload = Static<typeof SetDefaultModelPayloadSchema>;

export type FetchCustomProviderModelsPayload = Static<typeof FetchCustomProviderModelsPayloadSchema>;

export type FetchedCustomProviderModel = {
  id: string;
  name?: string;
};

export type FetchCustomProviderModelsResult = {
  models: FetchedCustomProviderModel[];
};

export type AddCustomProviderModelPayload = Static<typeof AddCustomProviderModelPayloadSchema>;

export type AddCustomProviderPayload = Static<typeof AddCustomProviderPayloadSchema>;

export type AddCustomModelPayload = Static<typeof AddCustomModelPayloadSchema>;

export type SetCustomProviderApiKeyPayload = Static<typeof SetCustomProviderApiKeyPayloadSchema>;

export type RemoveCustomProviderApiKeyPayload = Static<typeof RemoveCustomProviderApiKeyPayloadSchema>;

export type UpdateCustomModelInputPayload = Static<typeof UpdateCustomModelInputPayloadSchema>;

export type RemoveCustomModelPayload = Static<typeof RemoveCustomModelPayloadSchema>;
