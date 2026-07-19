import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  FetchCustomProviderModelsPayload,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';
import { replaceOrAppend } from 'radash';

import {
  normalizeCustomProviderApi,
  normalizeModelInput,
  normalizeProviderId,
  toOptionalContextWindow,
  validateContextWindow
} from './config-helpers';
import type { PiModelDefinition, PiModelsConfig, PiProviderConfig } from './config-types';
import type { PiModelConfigRepository } from './config-repository';
import type { FetchModelsSource } from './provider-model-fetcher';

/** 管理 agentDir/models.json 中的自定义供应商与模型配置。 */
export class PiCustomModelConfigService {
  constructor(private readonly repository: PiModelConfigRepository) {}

  /**
   * 解析“已保存供应商”或“尚未保存的表单草稿”为统一拉取参数。
   * 已保存模式从仓储补齐 baseUrl/API/key，草稿模式则只信任当前 payload。
   */
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
    const apiKey = payload.apiKey?.trim();

    if (!providerName) {
      throw new Error('供应商名称不能为空');
    }

    if (!baseUrl) {
      throw new Error('Base URL 不能为空');
    }

    await this.repository.update(config => {
      const previousProvider = config.providers[provider];

      config.providers[provider] = {
        ...previousProvider,
        name: providerName,
        api: payload.api,
        apiKey: apiKey || previousProvider?.apiKey,
        baseUrl,
        // 部分中转网关按 UA 拦截 openai SDK 默认标识，统一用应用 UA
        headers: previousProvider?.headers ?? { 'User-Agent': 'Chaptale/1.5.0' },
        models: upsertCustomModels(previousProvider?.models ?? [], payload.models)
      };
    });
  }

  async addModel(payload: AddCustomModelPayload) {
    const provider = normalizeProviderId(payload.provider);

    await this.repository.update(config => {
      const providerConfig = getProviderWithModelsOrThrow(config, provider);
      providerConfig.models = upsertCustomModel(providerConfig.models, toCustomModelDefinition(payload));
    });
  }

  async setProviderApiKey(payload: SetCustomProviderApiKeyPayload) {
    const provider = normalizeProviderId(payload.provider);
    const apiKey = payload.apiKey.trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    await this.repository.update(config => {
      getProviderOrThrow(config, provider).apiKey = apiKey;
    });
  }

  async removeProviderApiKey(payload: RemoveCustomProviderApiKeyPayload) {
    const provider = normalizeProviderId(payload.provider);

    await this.repository.update(config => {
      delete getProviderOrThrow(config, provider).apiKey;
    });
  }

  async updateModelInput(payload: UpdateCustomModelInputPayload) {
    const provider = normalizeProviderId(payload.provider);
    const modelId = readModelId(payload.modelId);
    const input = normalizeModelInput(payload.input);

    await this.repository.update(config => {
      const model = this.repository.findCustomModel(config, provider, modelId);
      model.input = input;
    });
  }

  async removeModel(payload: RemoveCustomModelPayload) {
    const provider = normalizeProviderId(payload.provider);
    const modelId = readModelId(payload.modelId);

    await this.repository.update(config => {
      const providerConfig = getProviderWithModelsOrThrow(config, provider);
      const nextModels = providerConfig.models.filter(model => model.id !== modelId);

      if (nextModels.length === providerConfig.models.length) {
        throw new Error(`未找到自定义模型：${provider}/${modelId}`);
      }

      // 没有模型和 override 的空供应商不再承载配置；仍有 override 时必须保留节点供 pi 合并。
      if (nextModels.length === 0 && !providerConfig.modelOverrides) {
        delete config.providers[provider];
      } else {
        providerConfig.models = nextModels;
      }
    });
  }
}

type CustomModelPayload = Pick<AddCustomModelPayload, 'modelId' | 'modelName' | 'input' | 'contextWindow'>;
type ProviderWithModels = PiProviderConfig & { models: PiModelDefinition[] };

function upsertCustomModels(models: PiModelDefinition[], payloads: CustomModelPayload[]) {
  return payloads.reduce(
    (nextModels, payload) => upsertCustomModel(nextModels, toCustomModelDefinition(payload)),
    models
  );
}

function upsertCustomModel(models: PiModelDefinition[], model: PiModelDefinition) {
  return replaceOrAppend(models, model, item => item.id === model.id);
}

function toCustomModelDefinition(payload: CustomModelPayload): PiModelDefinition {
  const modelId = readModelId(payload.modelId);
  const contextWindow = payload.contextWindow;

  validateContextWindow(contextWindow);

  return {
    id: modelId,
    name: payload.modelName?.trim() || modelId,
    input: normalizeModelInput(payload.input),
    contextWindow: toOptionalContextWindow(contextWindow)
  };
}

function getProviderOrThrow(config: PiModelsConfig, provider: string) {
  const providerConfig = config.providers[provider];

  if (!providerConfig) {
    throw new Error(`未找到自定义供应商：${provider}`);
  }

  return providerConfig;
}

function getProviderWithModelsOrThrow(config: PiModelsConfig, provider: string): ProviderWithModels {
  const providerConfig = getProviderOrThrow(config, provider);

  if (!providerConfig.models?.length) {
    throw new Error(`未找到自定义供应商：${provider}`);
  }

  return providerConfig as ProviderWithModels;
}

function readModelId(value: string) {
  const modelId = value.trim();

  if (!modelId) {
    throw new Error('模型 ID 不能为空');
  }

  return modelId;
}
