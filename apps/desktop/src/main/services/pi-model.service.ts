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
import { PiCustomModelConfigService } from '../models/pi-custom-model-config.service';
import { getModelKey, normalizeModelInput } from '../models/pi-model-config.helpers';
import { PiModelConfigRepository } from '../models/pi-model-config.repository';
import { fetchProviderModels } from '../models/provider-model-fetcher';
import type { SettingsService } from './settings.service';

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

  async listModels(): Promise<ListModelsResult> {
    // refresh 让 models.json / auth.json 的外部编辑即时生效
    this.authStorage.reload();
    this.modelRegistry.refresh();

    const settingsManager = await this.createSettingsManager();
    const defaultProvider = settingsManager.getDefaultProvider();
    const defaultModelId = settingsManager.getDefaultModel();
    const customModelKeys = await this.modelConfigRepository.getCustomModelKeys();

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
    const defaultModelExists = models.some(model => model.provider === defaultProvider && model.id === defaultModelId);

    return {
      models,
      providers: [...providerMap.values()].sort((left, right) => {
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
