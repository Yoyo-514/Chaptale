import { replaceOrAppend } from 'radash';

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
} from './config-helpers';
import type { ModelConfigRepository } from './config-repository';
import type { ModelDefinition, ModelsConfig, ModelProviderConfig } from './config-types';
import type { FetchModelsSource } from './provider-model-fetcher';

/** 管理 agentDir/models.json 中的自定义供应商与模型配置（自 integrations/pi 平移，语义不变）。 */
export class CustomModelConfigService {
  constructor(private readonly repository: ModelConfigRepository) {}

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

      // 空供应商不再承载配置，直接移除节点。
      if (nextModels.length === 0) {
        delete config.providers[provider];
      } else {
        providerConfig.models = nextModels;
      }
    });
  }
}

type CustomModelPayload = Pick<
  AddCustomModelPayload,
  'modelId' | 'modelName' | 'input' | 'contextWindow' | 'maxTokens' | 'temperature' | 'topP'
>;
type ProviderWithModels = ModelProviderConfig & { models: ModelDefinition[] };

function upsertCustomModels(models: ModelDefinition[], payloads: CustomModelPayload[]) {
  return payloads.reduce(
    (nextModels, payload) => upsertCustomModel(nextModels, toCustomModelDefinition(payload)),
    models
  );
}

function upsertCustomModel(models: ModelDefinition[], model: ModelDefinition) {
  return replaceOrAppend(models, model, item => item.id === model.id);
}

function toCustomModelDefinition(payload: CustomModelPayload): ModelDefinition {
  const modelId = readModelId(payload.modelId);
  const contextWindow = payload.contextWindow;

  validateContextWindow(contextWindow);
  validateModelParams(payload);

  return {
    id: modelId,
    name: payload.modelName?.trim() || modelId,
    input: normalizeModelInput(payload.input),
    contextWindow: toOptionalContextWindow(contextWindow),
    maxTokens: toOptionalPositiveNumber(payload.maxTokens),
    temperature: toOptionalNumberInRange(payload.temperature, 0, 2),
    topP: toOptionalNumberInRange(payload.topP, 0, 1)
  };
}

/** 采样/输出上限参数校验：超出 OpenAI 惯例范围直接拒绝，避免静默生效错误值。 */
function validateModelParams(payload: CustomModelPayload) {
  if (payload.maxTokens !== undefined && !(payload.maxTokens > 0)) {
    throw new Error('最大输出 tokens 必须为正数');
  }

  if (payload.temperature !== undefined && (payload.temperature < 0 || payload.temperature > 2)) {
    throw new Error('temperature 必须在 0 到 2 之间');
  }

  if (payload.topP !== undefined && (payload.topP < 0 || payload.topP > 1)) {
    throw new Error('topP 必须在 0 到 1 之间');
  }
}

function toOptionalPositiveNumber(value: number | undefined) {
  return value !== undefined && value > 0 ? value : undefined;
}

function toOptionalNumberInRange(value: number | undefined, min: number, max: number) {
  return value !== undefined && value >= min && value <= max ? value : undefined;
}

function getProviderOrThrow(config: ModelsConfig, provider: string) {
  const providerConfig = config.providers[provider];

  if (!providerConfig) {
    throw new Error(`未找到自定义供应商：${provider}`);
  }

  return providerConfig;
}

function getProviderWithModelsOrThrow(config: ModelsConfig, provider: string): ProviderWithModels {
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
