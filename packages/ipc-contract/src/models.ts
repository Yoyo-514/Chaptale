export type ChaptaleModelInput = 'text' | 'image';

export type ChaptaleCustomProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export type ChaptaleModelInfo = {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: ChaptaleModelInput[];
  contextWindow: number;
  isCustom: boolean;
  authConfigured: boolean;
  isDefault: boolean;
};

export type ChaptaleProviderInfo = {
  provider: string;
  providerName: string;
  authConfigured: boolean;
  authSource?: string;
  modelCount: number;
};

export type ListModelsResult = {
  models: ChaptaleModelInfo[];
  providers: ChaptaleProviderInfo[];
  defaultModel?: {
    provider: string;
    modelId: string;
  };
};

export type SetDefaultModelPayload = {
  provider: string;
  modelId: string;
};

export type SetProviderApiKeyPayload = {
  provider: string;
  apiKey: string;
};

export type FetchCustomProviderModelsPayload = {
  provider?: string;
  baseUrl?: string;
  api?: ChaptaleCustomProviderApi;
  apiKey?: string;
};

export type FetchedCustomProviderModel = {
  id: string;
  name?: string;
};

export type FetchCustomProviderModelsResult = {
  models: FetchedCustomProviderModel[];
};

export type AddCustomProviderModelPayload = {
  modelId: string;
  modelName?: string;
  input: ChaptaleModelInput[];
  contextWindow?: number;
};

export type AddCustomProviderPayload = {
  provider: string;
  providerName: string;
  baseUrl: string;
  api: ChaptaleCustomProviderApi;
  apiKey?: string;
  models: AddCustomProviderModelPayload[];
};

export type AddCustomModelPayload = {
  provider: string;
  modelId: string;
  modelName?: string;
  input: ChaptaleModelInput[];
  contextWindow?: number;
};

export type SetCustomProviderApiKeyPayload = {
  provider: string;
  apiKey: string;
};

export type RemoveCustomProviderApiKeyPayload = {
  provider: string;
};

export type UpdateCustomModelInputPayload = {
  provider: string;
  modelId: string;
  input: ChaptaleModelInput[];
};

export type RemoveCustomModelPayload = {
  provider: string;
  modelId: string;
};

export type RemoveProviderAuthPayload = {
  provider: string;
};
