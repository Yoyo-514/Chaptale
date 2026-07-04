import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';

import {
  normalizeCustomProviderApi,
  normalizeModelInput,
  normalizeProviderId,
  toOptionalContextWindow,
  validateContextWindow
} from './pi-model-config.helpers';
import type { PiModelConfigRepository } from './pi-model-config.repository';
import type { FetchModelsSource } from './provider-model-fetcher';

/** 管理 agentDir/models.json 中的自定义供应商与模型配置。 */
export class PiCustomModelConfigService {
  constructor(private readonly repository: PiModelConfigRepository) {}

  async resolveFetchModelsSource(payload: FetchCustomProviderModelsPayload): Promise<FetchModelsSource> {
    if (payload.provider) {
      const provider = normalizeProviderId(payload.provider);
      const config = await this.repository.read();
      const providerConfig = config.providers[provider];

      if (!providerConfig?.baseUrl || !providerConfig.api) {
        throw new Error(`未找到自定义供应商配置：${provider}`);
      }

      return {
        baseUrl: providerConfig.baseUrl,
        api: normalizeCustomProviderApi(providerConfig.api),
        apiKey: providerConfig.apiKey
      };
    }

    const baseUrl = payload.baseUrl?.trim();
    const api = payload.api;

    if (!baseUrl) {
      throw new Error('Base URL 不能为空');
    }

    if (!api) {
      throw new Error('API 类型不能为空');
    }

    return { baseUrl, api, apiKey: payload.apiKey };
  }

  async addProvider(payload: AddCustomProviderPayload) {
    const provider = normalizeProviderId(payload.provider);
    const providerName = payload.providerName.trim();
    const baseUrl = payload.baseUrl.trim();
    const modelId = payload.modelId.trim();
    const modelName = payload.modelName?.trim() || modelId;
    const contextWindow = payload.contextWindow;
    const input = normalizeModelInput(payload.input);
    const apiKey = payload.apiKey?.trim();

    if (!providerName) {
      throw new Error('供应商名称不能为空');
    }

    if (!baseUrl) {
      throw new Error('Base URL 不能为空');
    }

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    validateContextWindow(contextWindow);

    const config = await this.repository.read();
    const previousProvider = config.providers[provider];
    const previousModels = previousProvider?.models ?? [];
    const nextModels = previousModels.filter(model => model.id !== modelId);

    nextModels.push({
      id: modelId,
      name: modelName,
      input,
      contextWindow: toOptionalContextWindow(contextWindow)
    });

    config.providers[provider] = {
      ...previousProvider,
      name: providerName,
      api: payload.api,
      apiKey: apiKey || previousProvider?.apiKey,
      baseUrl,
      // 部分中转网关按 UA 拦截 openai SDK 默认标识，统一用应用 UA
      headers: previousProvider?.headers ?? { 'User-Agent': 'Chaptale/1.5.0' },
      models: nextModels
    };

    await this.repository.write(config);
  }

  async addModel(payload: AddCustomModelPayload) {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();
    const modelName = payload.modelName?.trim() || modelId;
    const contextWindow = payload.contextWindow;
    const input = normalizeModelInput(payload.input);

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    validateContextWindow(contextWindow);

    const config = await this.repository.read();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    providerConfig.models = [
      ...providerConfig.models.filter(model => model.id !== modelId),
      {
        id: modelId,
        name: modelName,
        input,
        contextWindow: toOptionalContextWindow(contextWindow)
      }
    ];

    await this.repository.write(config);
  }

  async setProviderApiKey(payload: SetCustomProviderApiKeyPayload) {
    const provider = normalizeProviderId(payload.provider);
    const apiKey = payload.apiKey.trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    const config = await this.repository.read();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    providerConfig.apiKey = apiKey;
    await this.repository.write(config);
  }

  async removeProviderApiKey(payload: RemoveCustomProviderApiKeyPayload) {
    const provider = normalizeProviderId(payload.provider);
    const config = await this.repository.read();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    delete providerConfig.apiKey;
    await this.repository.write(config);
  }

  async updateModelInput(payload: UpdateCustomModelInputPayload) {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();
    const input = normalizeModelInput(payload.input);

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    const config = await this.repository.read();
    const model = this.repository.findCustomModel(config, provider, modelId);
    model.input = input;

    await this.repository.write(config);
  }

  async removeModel(payload: RemoveCustomModelPayload) {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    const config = await this.repository.read();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    const nextModels = providerConfig.models.filter(model => model.id !== modelId);

    if (nextModels.length === providerConfig.models.length) {
      throw new Error(`未找到自定义模型：${provider}/${modelId}`);
    }

    if (nextModels.length === 0 && !providerConfig.modelOverrides) {
      delete config.providers[provider];
    } else {
      providerConfig.models = nextModels;
    }

    await this.repository.write(config);
  }
}
