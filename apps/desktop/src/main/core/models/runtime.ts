import type { LanguageModel } from 'ai';

import { effectiveContextWindow, normalizeModelInput } from './config-helpers';
import type { ModelConfigRepository } from './config-repository';
import type { ModelDefinition, ModelsConfig, ModelProviderConfig } from './config-types';
import { createProtocolLanguageModel } from './protocols';

/** 引擎消费的解析产物：LanguageModel + 上下文估算与输入能力。 */
export type ResolvedModel = {
  model: LanguageModel;
  provider: string;
  modelId: string;
  /** 有效上下文窗口（未填写时 128k 估算）。 */
  contextWindow: number;
  input: ('text' | 'image')[];
  /** 单次回复最大输出 tokens；缺省交由服务端默认。 */
  maxTokens?: number;
  /** 采样温度；缺省交由服务端默认。 */
  temperature?: number;
  /** 核采样阈值；缺省交由服务端默认。 */
  topP?: number;
};

/**
 * 模型解析：models.json 配置 → AI SDK LanguageModel。
 *
 * 每次解析重读配置文件——设置变更对话轮即时生效，且免维护缓存失效逻辑；
 * 对话启动一次读文件的开销相对网络请求可忽略。
 */
export class ModelRuntime {
  constructor(private readonly repository: ModelConfigRepository) {}

  async resolveModel(providerId: string, modelId: string): Promise<ResolvedModel> {
    const config = await this.repository.read();
    return this.resolveModelFromConfig(config, providerId, modelId);
  }

  /** 从既有配置快照解析（service 层复用，避免重复读盘）。 */
  resolveModelFromConfig(config: ModelsConfig, providerId: string, modelId: string): ResolvedModel {
    const providerConfig = config.providers[providerId];

    if (!providerConfig) {
      throw new Error(`未找到供应商：${providerId}`);
    }

    const model = findModel(providerConfig, modelId);

    return {
      model: createProtocolLanguageModel(
        {
          providerId,
          api: resolveApi(providerConfig, model),
          baseUrl: resolveBaseUrl(providerConfig, model),
          apiKey: providerConfig.apiKey,
          headers: { ...providerConfig.headers, ...model?.headers }
        },
        modelId
      ),
      provider: providerId,
      modelId,
      contextWindow: effectiveContextWindow(model?.contextWindow),
      input: normalizeModelInput(model?.input),
      maxTokens: model?.maxTokens,
      temperature: model?.temperature,
      topP: model?.topP
    };
  }
}

function findModel(providerConfig: ModelProviderConfig, modelId: string): ModelDefinition | undefined {
  return providerConfig.models?.find(model => model.id === modelId);
}

/** api 优先级：model 级覆盖 > provider 级；都没有时按兼容站惯例回落 openai-completions。 */
function resolveApi(providerConfig: ModelProviderConfig, model: ModelDefinition | undefined) {
  const api = model?.api ?? providerConfig.api;

  if (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'anthropic-messages' ||
    api === 'google-generative-ai'
  ) {
    return api;
  }

  return 'openai-completions' as const;
}

function resolveBaseUrl(providerConfig: ModelProviderConfig, model: ModelDefinition | undefined) {
  return model?.baseUrl ?? providerConfig.baseUrl;
}
