import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';

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
  RemoveProviderAuthPayload,
  SetCustomProviderApiKeyPayload,
  SetDefaultModelPayload,
  SetProviderApiKeyPayload,
  UpdateCustomModelInputPayload
} from '@chaptale/ipc-contract';
import type { AuthCheck, AuthInteraction, Model } from '@earendil-works/pi-ai';
import type { SettingsService } from '../../../modules/settings/service';
import { PiCustomModelConfigService } from './config-service';
import { getModelKey, normalizeModelInput } from './config-helpers';
import { PiModelConfigRepository } from './config-repository';
import { fetchProviderModels } from './provider-model-fetcher';

type ModelRuntimeFactory = () => Promise<ModelRuntime>;

const SINGLE_KEY_AUTH_SELECTIONS: Record<string, string> = {
  'amazon-bedrock': 'bearer-token',
  'google-vertex': 'api-key'
};

/**
 * 基于 pi SDK 的模型与凭据服务。
 *
 * - 模型清单：pi 内置模型 + agentDir/models.json 自定义模型；
 * - 凭据：由 ModelRuntime 持久化到 agentDir/auth.json；
 * - 默认模型：pi agentDir/settings.json（SettingsManager 持久化）。
 */
export class PiModelService {
  private modelRuntimePromise: Promise<ModelRuntime> | undefined;
  private modelRuntimeQueue = Promise.resolve();
  private readonly modelRuntimeFactory: ModelRuntimeFactory;
  private readonly modelConfigRepository: PiModelConfigRepository;
  private readonly customModelConfig: PiCustomModelConfigService;

  constructor(
    private readonly settingsService: SettingsService,
    modelRuntimeFactory?: ModelRuntimeFactory
  ) {
    this.modelRuntimeFactory =
      modelRuntimeFactory ??
      (() =>
        ModelRuntime.create({
          authPath: settingsService.piAuthPath,
          modelsPath: settingsService.piModelsPath
        }));
    this.modelConfigRepository = new PiModelConfigRepository({
      modelsPath: settingsService.piModelsPath,
      onWrite: () => this.runWithModelRuntime(modelRuntime => modelRuntime.reloadConfig())
    });
    this.customModelConfig = new PiCustomModelConfigService(this.modelConfigRepository);
  }

  /** 首次使用时创建 ModelRuntime；并发调用共享同一个初始化 Promise 与实例。 */
  getModelRuntime() {
    this.modelRuntimePromise ??= this.modelRuntimeFactory();
    return this.modelRuntimePromise;
  }

  /** 当前默认模型（settings.json）对应的 pi Model，未配置时返回 undefined。 */
  getDefaultPiModel(): Promise<Model<any> | undefined> {
    return this.runWithModelRuntime(async modelRuntime => {
      const settingsManager = await this.createSettingsManager();
      const provider = settingsManager.getDefaultProvider();
      const modelId = settingsManager.getDefaultModel();

      if (!provider || !modelId) {
        return undefined;
      }

      return modelRuntime.getModel(provider, modelId);
    });
  }

  /**
   * 汇总 pi 运行时、用户自定义配置、认证状态和默认模型为 Renderer 使用的稳定视图。
   * 显式列表请求会重新加载 models.json，使应用外的模型配置修改无需重启即可生效。
   */
  listModels(): Promise<ListModelsResult> {
    return this.runWithModelRuntime(async modelRuntime => {
      await modelRuntime.reloadConfig();
      return this.buildModelsResult(modelRuntime);
    });
  }

  setDefaultModel(payload: SetDefaultModelPayload): Promise<ListModelsResult> {
    return this.runWithModelRuntime(async modelRuntime => {
      const model = modelRuntime.getModel(payload.provider, payload.modelId);

      if (!model) {
        throw new Error(`未找到模型：${payload.provider}/${payload.modelId}`);
      }

      const settingsManager = await this.createSettingsManager();
      settingsManager.setDefaultModelAndProvider(payload.provider, payload.modelId);
      return this.buildModelsResult(modelRuntime);
    });
  }

  async setProviderApiKey(payload: SetProviderApiKeyPayload): Promise<ListModelsResult> {
    const apiKey = payload.apiKey.trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    return this.runWithModelRuntime(async modelRuntime => {
      await modelRuntime.login(payload.provider, 'api_key', createApiKeyLoginInteraction(payload.provider, apiKey));
      return this.buildModelsResult(modelRuntime);
    });
  }

  async fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload): Promise<FetchCustomProviderModelsResult> {
    const source = await this.customModelConfig.resolveFetchModelsSource(payload);
    return fetchProviderModels(source);
  }

  async addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult> {
    await this.customModelConfig.addProvider(payload);
    return this.projectModels();
  }

  async addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult> {
    await this.customModelConfig.addModel(payload);
    return this.projectModels();
  }

  async setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customModelConfig.setProviderApiKey(payload);
    return this.projectModels();
  }

  async removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customModelConfig.removeProviderApiKey(payload);
    return this.projectModels();
  }

  async updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult> {
    await this.customModelConfig.updateModelInput(payload);
    return this.projectModels();
  }

  async removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult> {
    await this.customModelConfig.removeModel(payload);
    return this.projectModels();
  }

  removeProviderAuth(payload: RemoveProviderAuthPayload): Promise<ListModelsResult> {
    return this.runWithModelRuntime(async modelRuntime => {
      await modelRuntime.logout(payload.provider);
      return this.buildModelsResult(modelRuntime);
    });
  }

  private projectModels(): Promise<ListModelsResult> {
    return this.runWithModelRuntime(modelRuntime => this.buildModelsResult(modelRuntime));
  }

  /**
   * 串行化同一 ModelRuntime 上的配置刷新、凭据修改与同步快照读取。
   * 前一次操作失败后仍释放队列，使后续设置操作可以继续尝试。
   */
  private runWithModelRuntime<T>(operation: (modelRuntime: ModelRuntime) => Promise<T>): Promise<T> {
    const run = this.modelRuntimeQueue.then(
      async () => operation(await this.getModelRuntime()),
      async () => operation(await this.getModelRuntime())
    );
    this.modelRuntimeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async buildModelsResult(modelRuntime: ModelRuntime): Promise<ListModelsResult> {
    const settingsManager = await this.createSettingsManager();
    const defaultProvider = settingsManager.getDefaultProvider();
    const defaultModelId = settingsManager.getDefaultModel();
    const customConfig = await this.modelConfigRepository.read().catch(() => ({ providers: {} }));
    const customModelKeys = new Set(
      Object.entries(customConfig.providers).flatMap(([provider, providerConfig]) =>
        (providerConfig.models ?? []).map(model => getModelKey(provider, model.id))
      )
    );
    const runtimeModels = modelRuntime.getModels();
    const providerNames = new Map(modelRuntime.getProviders().map(provider => [provider.id, provider.name]));
    const providerIds = new Set([
      ...runtimeModels.map(model => model.provider),
      ...Object.keys(customConfig.providers)
    ]);
    const authChecks = new Map(
      await Promise.all(
        [...providerIds].map(async provider => [provider, await modelRuntime.checkAuth(provider)] as const)
      )
    );

    const models: ChaptaleModelInfo[] = runtimeModels.map(model => ({
      provider: model.provider,
      providerName: providerNames.get(model.provider) ?? model.provider,
      id: model.id,
      name: model.name,
      reasoning: Boolean(model.reasoning),
      input: normalizeModelInput(model.input),
      contextWindow: model.contextWindow,
      isCustom: customModelKeys.has(getModelKey(model.provider, model.id)),
      authConfigured: authChecks.get(model.provider) !== undefined,
      isDefault: model.provider === defaultProvider && model.id === defaultModelId
    }));

    const providerMap = this.createProviderMap(models, authChecks);

    // 即使自定义供应商暂时没有可枚举模型，也要保留在设置页，便于继续补 key 或添加模型。
    for (const [provider, providerConfig] of Object.entries(customConfig.providers)) {
      if (providerMap.has(provider)) {
        continue;
      }

      const authCheck = authChecks.get(provider);
      providerMap.set(provider, {
        provider,
        providerName: providerConfig.name || provider,
        authConfigured: authCheck !== undefined || Boolean(providerConfig.apiKey),
        authSource: authCheck?.source ?? (providerConfig.apiKey ? 'models.json' : undefined),
        modelCount: providerConfig.models?.length ?? 0
      });
    }
    const defaultModelExists = models.some(model => model.provider === defaultProvider && model.id === defaultModelId);

    return {
      models,
      providers: [...providerMap.values()].toSorted((left, right) => {
        if (left.authConfigured !== right.authConfigured) {
          return left.authConfigured ? -1 : 1;
        }

        return left.providerName.localeCompare(right.providerName);
      }),
      defaultModel:
        defaultProvider && defaultModelId && defaultModelExists
          ? { provider: defaultProvider, modelId: defaultModelId }
          : undefined
    };
  }

  private async createSettingsManager() {
    const cwd = await this.settingsService.getCurrentCwd();
    return SettingsManager.create(cwd, this.settingsService.agentDir);
  }

  private createProviderMap(models: ChaptaleModelInfo[], authChecks: Map<string, AuthCheck | undefined>) {
    const providerMap = new Map<string, ChaptaleProviderInfo>();

    for (const model of models) {
      const existing = providerMap.get(model.provider);

      if (existing) {
        existing.modelCount += 1;
        continue;
      }

      const authCheck = authChecks.get(model.provider);
      providerMap.set(model.provider, {
        provider: model.provider,
        providerName: model.providerName,
        authConfigured: authCheck !== undefined,
        authSource: authCheck?.source,
        modelCount: 1
      });
    }

    return providerMap;
  }
}

function createApiKeyLoginInteraction(provider: string, apiKey: string): AuthInteraction {
  return {
    async prompt(prompt) {
      if (prompt.type === 'secret') {
        return apiKey;
      }

      const selection = SINGLE_KEY_AUTH_SELECTIONS[provider];
      if (prompt.type === 'select' && selection && prompt.options.some(option => option.id === selection)) {
        return selection;
      }

      throw new Error('当前供应商需要额外认证信息，暂不支持通过单一 API Key 字段配置');
    },
    notify() {}
  };
}
