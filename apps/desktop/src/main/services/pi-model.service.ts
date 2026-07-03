import { AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AddCustomModelPayload,
  AddCustomProviderPayload,
  ChaptaleCustomProviderApi,
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

  constructor(private readonly settingsService: SettingsService) {
    this.authStorage = AuthStorage.create(settingsService.piAuthPath);
    this.modelRegistry = ModelRegistry.create(this.authStorage, settingsService.piModelsPath);
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

  private async createSettingsManager() {
    const cwd = await this.settingsService.getCurrentCwd();
    return SettingsManager.create(cwd, this.settingsService.agentDir);
  }

  async listModels(): Promise<ListModelsResult> {
    // refresh 让 models.json / auth.json 的外部编辑即时生效
    this.authStorage.reload();
    this.modelRegistry.refresh();

    const settingsManager = await this.createSettingsManager();
    const defaultProvider = settingsManager.getDefaultProvider();
    const defaultModelId = settingsManager.getDefaultModel();
    const customModelKeys = await this.getCustomModelKeys();

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
    const source = await this.resolveFetchModelsSource(payload);
    const apiKey = source.apiKey?.trim();

    if (!apiKey) {
      throw new Error('请先填写模型 Key，再拉取模型列表');
    }

    if (source.api === 'anthropic-messages') {
      throw new Error('当前 API 类型没有通用模型列表接口');
    }

    const url = createModelsUrl(source.baseUrl, source.api, apiKey);
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };

    if (apiKey && source.api !== 'google-generative-ai') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (apiKey && source.api === 'google-generative-ai') {
      headers['x-goog-api-key'] = apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`模型列表请求失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as unknown;
    return { models: parseFetchedModels(data, source.api) };
  }

  private async resolveFetchModelsSource(payload: FetchCustomProviderModelsPayload): Promise<FetchModelsSource> {
    if (payload.provider) {
      const provider = normalizeProviderId(payload.provider);
      const config = await this.readModelsConfig();
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

  async addCustomProvider(payload: AddCustomProviderPayload): Promise<ListModelsResult> {
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

    if (contextWindow !== undefined && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
      throw new Error('Context Window 必须是大于 0 的数字');
    }

    const config = await this.readModelsConfig();
    const previousProvider = config.providers[provider];
    const previousModels = previousProvider?.models ?? [];
    const nextModels = previousModels.filter(model => model.id !== modelId);

    nextModels.push({
      id: modelId,
      name: modelName,
      input,
      contextWindow: contextWindow ? Math.trunc(contextWindow) : undefined
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

    await this.writeModelsConfig(config);
    return this.listModels();
  }

  async addCustomModel(payload: AddCustomModelPayload): Promise<ListModelsResult> {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();
    const modelName = payload.modelName?.trim() || modelId;
    const contextWindow = payload.contextWindow;
    const input = normalizeModelInput(payload.input);

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    if (contextWindow !== undefined && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
      throw new Error('Context Window 必须是大于 0 的数字');
    }

    const config = await this.readModelsConfig();
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
        contextWindow: contextWindow ? Math.trunc(contextWindow) : undefined
      }
    ];

    await this.writeModelsConfig(config);
    return this.listModels();
  }

  async setCustomProviderApiKey(payload: SetCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    const provider = normalizeProviderId(payload.provider);
    const apiKey = payload.apiKey.trim();

    if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    const config = await this.readModelsConfig();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    providerConfig.apiKey = apiKey;
    await this.writeModelsConfig(config);
    return this.listModels();
  }

  async removeCustomProviderApiKey(payload: RemoveCustomProviderApiKeyPayload): Promise<ListModelsResult> {
    const provider = normalizeProviderId(payload.provider);
    const config = await this.readModelsConfig();
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    delete providerConfig.apiKey;
    await this.writeModelsConfig(config);
    return this.listModels();
  }

  async updateCustomModelInput(payload: UpdateCustomModelInputPayload): Promise<ListModelsResult> {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();
    const input = normalizeModelInput(payload.input);

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    const config = await this.readModelsConfig();
    const model = this.findCustomModel(config, provider, modelId);
    model.input = input;

    await this.writeModelsConfig(config);
    return this.listModels();
  }

  async removeCustomModel(payload: RemoveCustomModelPayload): Promise<ListModelsResult> {
    const provider = normalizeProviderId(payload.provider);
    const modelId = payload.modelId.trim();

    if (!modelId) {
      throw new Error('模型 ID 不能为空');
    }

    const config = await this.readModelsConfig();
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

    await this.writeModelsConfig(config);
    return this.listModels();
  }

  private findCustomModel(config: PiModelsConfig, provider: string, modelId: string) {
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    const model = providerConfig.models.find(model => model.id === modelId);

    if (!model) {
      throw new Error(`未找到自定义模型：${provider}/${modelId}`);
    }

    return model;
  }

  private async readModelsConfig(): Promise<PiModelsConfig> {
    try {
      const content = await readFile(this.settingsService.piModelsPath, 'utf8');
      const parsed = JSON.parse(stripJsonComments(content)) as unknown;

      if (!parsed || typeof parsed !== 'object' || !('providers' in parsed)) {
        throw new Error('models.json 必须包含 providers 对象');
      }

      const config = parsed as PiModelsConfig;
      if (!config.providers || typeof config.providers !== 'object' || Array.isArray(config.providers)) {
        throw new Error('models.json 的 providers 必须是对象');
      }

      return config;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { providers: {} };
      }

      throw error;
    }
  }

  private async writeModelsConfig(config: PiModelsConfig) {
    await mkdir(path.dirname(this.settingsService.piModelsPath), { recursive: true });
    await writeFile(this.settingsService.piModelsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    this.modelRegistry.refresh();
  }

  private async getCustomModelKeys() {
    try {
      const config = await this.readModelsConfig();
      return new Set(
        Object.entries(config.providers).flatMap(([provider, config]) =>
          (config.models ?? []).map(model => getModelKey(provider, model.id))
        )
      );
    } catch {
      return new Set<string>();
    }
  }

  async removeProviderAuth(payload: RemoveProviderAuthPayload): Promise<ListModelsResult> {
    this.authStorage.remove(payload.provider);
    return this.listModels();
  }
}

type FetchModelsSource = {
  baseUrl: string;
  api: ChaptaleCustomProviderApi;
  apiKey?: string;
};

type PiModelsConfig = {
  providers: Record<string, PiProviderConfig>;
};

type PiProviderConfig = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: unknown;
  modelOverrides?: Record<string, unknown>;
  models?: PiModelDefinition[];
};

type PiModelDefinition = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: unknown;
};

function normalizeCustomProviderApi(api: string): ChaptaleCustomProviderApi {
  if (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'anthropic-messages' ||
    api === 'google-generative-ai'
  ) {
    return api;
  }

  throw new Error(`不支持的 API 类型：${api}`);
}

function createModelsUrl(baseUrl: string, api: ChaptaleCustomProviderApi, apiKey?: string) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/models`);

  // Google Generative AI 的公开列表接口常见用法是 key query；同时服务层也会带 x-goog-api-key header。
  if (api === 'google-generative-ai' && apiKey) {
    url.searchParams.set('key', apiKey);
  }

  return url;
}

function parseFetchedModels(data: unknown, api: ChaptaleCustomProviderApi) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];

  return rawModels
    .map(item => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const model = item as Record<string, unknown>;
      const rawId = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : '';
      const id = api === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId;
      const name =
        typeof model.name === 'string' && model.name !== rawId
          ? model.name
          : typeof model.displayName === 'string'
            ? model.displayName
            : id;

      return id ? { id, name } : undefined;
    })
    .filter((model): model is { id: string; name: string } => model !== undefined);
}

function getModelKey(provider: string, modelId: string) {
  return `${provider}:${modelId}`;
}

function normalizeModelInput(input: unknown): ('text' | 'image')[] {
  if (!Array.isArray(input)) {
    return ['text'];
  }

  const normalized = input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image');

  if (!normalized.includes('text')) {
    normalized.unshift('text');
  }

  return [...new Set(normalized)];
}

function normalizeProviderId(provider: string) {
  const normalized = provider.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error('供应商 ID 只能包含字母、数字、点、下划线和短横线');
  }

  return normalized;
}

function stripJsonComments(content: string) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
