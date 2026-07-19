import { AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';

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
import type { Model } from '@earendil-works/pi-ai';
import type { SettingsService } from '../../../modules/settings/service';
import { PiCustomModelConfigService } from './config-service';
import { getModelKey, normalizeModelInput } from './config-helpers';
import { PiModelConfigRepository } from './config-repository';
import { fetchProviderModels } from './provider-model-fetcher';

/**
 * 基于 pi SDK 的模型与凭据服务。
 *
 * - 模型清单：pi 内置模型 + agentDir/models.json 自定义模型；
 * - 凭据：agentDir/auth.json（由 pi AuthStorage 管理，含文件锁）；
 * - 默认模型：pi agentDir/settings.json（SettingsManager 持久化）。
 */
export class PiModelService {
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly modelConfigRepository: PiModelConfigRepository;
  private readonly customModelConfig: PiCustomModelConfigService;

  constructor(private readonly settingsService: SettingsService) {
    this.authStorage = AuthStorage.create(settingsService.piAuthPath);
    this.modelRegistry = ModelRegistry.create(this.authStorage, settingsService.piModelsPath);
    this.modelConfigRepository = new PiModelConfigRepository({
      modelsPath: settingsService.piModelsPath,
      onWrite: () => this.modelRegistry.refresh()
    });
    this.customModelConfig = new PiCustomModelConfigService(this.modelConfigRepository);
  }

  getAuthStorage() {
    return this.authStorage;
  }

  getModelRegistry() {
    return this.modelRegistry;
  }

  /** 当前默认模型（settings.json）对应的 pi Model，未配置时返回 undefined。 */
  async getDefaultPiModel(): Promise<Model<any> | undefined> {
    this.authStorage.reload();
    this.modelRegistry.refresh();

    const settingsManager = await this.createSettingsManager();
    const provider = settingsManager.getDefaultProvider();
    const modelId = settingsManager.getDefaultModel();

    if (!provider || !modelId) {
      return undefined;
    }

    return this.modelRegistry.find(provider, modelId);
  }

  /**
   * 汇总 pi 注册表、用户自定义配置、认证状态和默认模型为 Renderer 使用的稳定视图。
   * 每次读取前刷新 SDK 缓存，使用户在应用外修改 models.json/auth.json 后无需重启。
   */
  async listModels(): Promise<ListModelsResult> {
    // refresh 让 models.json / auth.json 的外部编辑即时生效
    this.authStorage.reload();
    this.modelRegistry.refresh();

    const settingsManager = await this.createSettingsManager();
    const defaultProvider = settingsManager.getDefaultProvider();
    const defaultModelId = settingsManager.getDefaultModel();
    const customConfig = await this.modelConfigRepository.read().catch(() => ({ providers: {} }));
    const customModelKeys = new Set(
      Object.entries(customConfig.providers).flatMap(([provider, providerConfig]) =>
        (providerConfig.models ?? []).map(model => getModelKey(provider, model.id))
      )
    );

    const models: ChaptaleModelInfo[] = this.modelRegistry.getAll().map(model => ({
      provider: model.provider,
      providerName: this.modelRegistry.getProviderDisplayName(model.provider),
      id: model.id,
      name: model.name,
      reasoning: Boolean(model.reasoning),
      input: normalizeModelInput(model.input),
      contextWindow: model.contextWindow,
      isCustom: customModelKeys.has(getModelKey(model.provider, model.id)),
      authConfigured: this.modelRegistry.hasConfiguredAuth(model),
      isDefault: model.provider === defaultProvider && model.id === defaultModelId
    }));

    const providerMap = this.createProviderMap(models);

    // 即使自定义供应商暂时没有可枚举模型，也要保留在设置页，便于继续补 key 或添加模型。
    for (const [provider, providerConfig] of Object.entries(customConfig.providers)) {
      if (providerMap.has(provider)) {
        continue;
      }

      providerMap.set(provider, {
        provider,
        providerName: providerConfig.name || provider,
        authConfigured: Boolean(providerConfig.apiKey),
        authSource: providerConfig.apiKey ? 'models.json' : undefined,
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

  async setDefaultModel(payload: SetDefaultModelPayload): Promise<ListModelsResult> {
    const model = this.modelRegistry.find(payload.provider, payload.modelId);

    if (!model) {
      throw new Error(`未找到模型：${payload.provider}/${payload.modelId}`);
    }

    const settingsManager = await this.createSettingsManager();
    settingsManager.setDefaultModelAndProvider(payload.provider, payload.modelId);
    return this.listModels();
  }

  async setProviderApiKey(payload: SetProviderApiKeyPayload): Promise<ListModelsResult> {
    const apiKey = payload.apiKey.trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    this.authStorage.set(payload.provider, { type: 'api_key', key: apiKey });
    return this.listModels();
  }

  async fetchCustomProviderModels(payload: FetchCustomProviderModelsPayload): Promise<FetchCustomProviderModelsResult> {
    const source = await this.customModelConfig.resolveFetchModelsSource(payload);
    return fetchProviderModels(source);
  }

  async addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult> {
    await this.customModelConfig.addProvider(payload);
    return this.listModels();
  }

  async addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult> {
    await this.customModelConfig.addModel(payload);
    return this.listModels();
  }

  async setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customModelConfig.setProviderApiKey(payload);
    return this.listModels();
  }

  async removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    await this.customModelConfig.removeProviderApiKey(payload);
    return this.listModels();
  }

  async updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult> {
    await this.customModelConfig.updateModelInput(payload);
    return this.listModels();
  }

  async removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult> {
    await this.customModelConfig.removeModel(payload);
    return this.listModels();
  }

  async removeProviderAuth(payload: RemoveProviderAuthPayload): Promise<ListModelsResult> {
    this.authStorage.remove(payload.provider);
    return this.listModels();
  }

  private async createSettingsManager() {
    const cwd = await this.settingsService.getCurrentCwd();
    return SettingsManager.create(cwd, this.settingsService.agentDir);
  }

  private createProviderMap(models: ChaptaleModelInfo[]) {
    const providerMap = new Map<string, ChaptaleProviderInfo>();

    for (const model of models) {
      const existing = providerMap.get(model.provider);

      if (existing) {
        existing.modelCount += 1;
        continue;
      }

      const authStatus = this.modelRegistry.getProviderAuthStatus(model.provider);
      providerMap.set(model.provider, {
        provider: model.provider,
        providerName: model.providerName,
        authConfigured: authStatus.configured,
        authSource: authStatus.source,
        modelCount: 1
      });
    }

    return providerMap;
  }
}
