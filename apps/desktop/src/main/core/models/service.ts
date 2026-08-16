import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  ChaptaleModelInfo,
  ChaptaleProviderInfo,
  FetchCustomProviderModelsPayload,
  FetchCustomProviderModelsResult,
  ListModelsResult,
  RemoveCustomModelPayload,
  RemoveCustomProviderApiKeyPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';

import { normalizeCustomProviderApi, normalizeModelInput } from './config-helpers';
import { ModelConfigRepository } from './config-repository';
import { CustomModelConfigService } from './config-service';
import type { ModelRef, ModelsConfig } from './config-types';
import { fetchProviderModels } from './provider-model-fetcher';
import { ModelRuntime } from './runtime';

export type ModelServiceOptions = {
  modelsPath: string;
};

/**
 * 自有模型服务：models.json 唯一事实源，listModels 结果只含自定义 providers。
 *
 * - 无内置 provider 目录、无 OAuth——apiKey 即凭据（存在性 = authConfigured）；
 * - 默认模型存 models.json 顶层 defaultModel。
 */
export class ModelService {
  private readonly repository: ModelConfigRepository;
  private readonly customConfig: CustomModelConfigService;
  readonly runtime: ModelRuntime;

  constructor(options: ModelServiceOptions) {
    this.repository = new ModelConfigRepository({ modelsPath: options.modelsPath });
    this.customConfig = new CustomModelConfigService(this.repository);
    this.runtime = new ModelRuntime(this.repository);
  }

  /** 引擎接入点：模型解析器（streamText 前 resolveModel）。 */
  getModelRuntime() {
    return this.runtime;
  }

  async getDefaultModel(): Promise<ModelRef | undefined> {
    return this.repository.getDefaultModel();
  }

  async listModels(): Promise<ListModelsResult> {
    const config = await this.repository.read();

    return this.buildModelsResult(config);
  }

  async setDefaultModel(payload: SetDefaultModelPayload): Promise<ListModelsResult> {
    const config = await this.repository.read();
    const providerConfig = config.providers[payload.provider];

    if (!providerConfig?.models?.some(model => model.id === payload.modelId)) {
      throw new Error(`未找到模型：${payload.provider}/${payload.modelId}`);
    }

    await this.repository.setDefaultModel({ provider: payload.provider, modelId: payload.modelId });

    return this.listModels();
  }

  /**
   * 凭据探测三态：true 可用 / false 拒绝（401、403 或缺 key）/ undefined 无法判定
   * （网络错误、5xx、无列表接口的协议）。与旧三态语义对齐，UI 提示文案沿用。
   */
  async checkAuth(provider: string): Promise<boolean | undefined> {
    const config = await this.repository.read();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.baseUrl || !providerConfig.api) {
      return false;
    }

    if (!providerConfig.apiKey) {
      return false;
    }

    if (providerConfig.api === 'anthropic-messages') {
      return undefined;
    }

    try {
      await fetchProviderModels({
        baseUrl: providerConfig.baseUrl,
        api: normalizeCustomProviderApi(providerConfig.api),
        apiKey: providerConfig.apiKey
      });

      return true;
    } catch (error) {
      return /HTTP (401|403)/.test((error as Error).message) ? false : undefined;
    }
  }

  async fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload): Promise<FetchCustomProviderModelsResult> {
    const source = await this.customConfig.resolveFetchModelsSource(payload);
    return fetchProviderModels(source);
  }

  async addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult> {
    await this.customConfig.addProvider(payload);
    return this.listModels();
  }

  async addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult> {
    await this.customConfig.addModel(payload);
    return this.listModels();
  }

  async setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customConfig.setProviderApiKey(payload);
    return this.listModels();
  }

  async removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customConfig.removeProviderApiKey(payload);
    return this.listModels();
  }

  async updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult> {
    await this.customConfig.updateModelInput(payload);
    return this.listModels();
  }

  async removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult> {
    await this.customConfig.removeModel(payload);

    // 默认模型被删时同步清除，避免 listModels 悬空引用。
    const current = await this.repository.getDefaultModel();

    if (current && current.provider === payload.provider && current.modelId === payload.modelId) {
      await this.repository.setDefaultModel(undefined);
    }

    return this.listModels();
  }

  private async buildModelsResult(config: ModelsConfig): Promise<ListModelsResult> {
    const defaultModel = config.defaultModel;
    const models: ChaptaleModelInfo[] = [];

    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      for (const model of providerConfig.models ?? []) {
        models.push({
          provider,
          providerName: providerConfig.name || provider,
          id: model.id,
          name: model.name || model.id,
          reasoning: Boolean(model.reasoning),
          input: normalizeModelInput(model.input),
          contextWindow: model.contextWindow ?? 128_000,
          ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
          ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
          ...(model.topP !== undefined ? { topP: model.topP } : {}),
          isCustom: true,
          authConfigured: Boolean(providerConfig.apiKey),
          isDefault: defaultModel?.provider === provider && defaultModel.modelId === model.id
        });
      }
    }

    const providers = new Map<string, ChaptaleProviderInfo>();

    for (const [provider, providerConfig] of Object.entries(config.providers)) {
      providers.set(provider, {
        provider,
        providerName: providerConfig.name || provider,
        authConfigured: Boolean(providerConfig.apiKey),
        authSource: providerConfig.apiKey ? 'models.json' : undefined,
        modelCount: providerConfig.models?.length ?? 0
      });
    }

    const defaultModelExists = models.some(
      model => model.provider === defaultModel?.provider && model.id === defaultModel.modelId
    );

    return {
      models,
      providers: [...providers.values()].toSorted((left, right) => {
        if (left.authConfigured !== right.authConfigured) {
          return left.authConfigured ? -1 : 1;
        }

        return left.providerName.localeCompare(right.providerName);
      }),
      defaultModel: defaultModelExists ? defaultModel : undefined
    };
  }
}
