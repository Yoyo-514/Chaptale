import type { AuthInteraction } from '@earendil-works/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  modelRuntimeCreate: vi.fn(),
  settingsManagerCreate: vi.fn()
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: sdkMocks.modelRuntimeCreate },
  SettingsManager: { create: sdkMocks.settingsManagerCreate }
}));

import { PiModelService } from '../service';

function createSettingsService() {
  return {
    agentDir: 'C:/chaptale/agent',
    piAuthPath: 'C:/chaptale/agent/auth.json',
    piModelsPath: 'C:/chaptale/agent/models.json',
    getCurrentCwd: vi.fn(async () => 'C:/workspace')
  };
}

function createModelRuntime() {
  const model = {
    provider: 'openai',
    id: 'gpt-test',
    name: 'GPT Test',
    reasoning: false,
    input: ['text'],
    contextWindow: 128_000
  };

  return {
    reloadConfig: vi.fn(async () => undefined),
    getModels: vi.fn(() => [model]),
    getModel: vi.fn((provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined
    ),
    getProviders: vi.fn(() => [{ id: 'openai', name: 'OpenAI' }]),
    checkAuth: vi.fn(async (provider: string) =>
      provider === 'openai' ? { type: 'api_key' as const, source: 'stored credential' } : undefined
    ),
    login: vi.fn(async (_provider: string, _type: 'api_key' | 'oauth', _interaction: AuthInteraction) => ({
      type: 'api_key' as const,
      key: 'stored'
    })),
    logout: vi.fn(async (_provider: string) => undefined)
  };
}

function createService(runtime = createModelRuntime()) {
  const settingsService = createSettingsService();
  const modelRuntimeFactory = vi.fn(async () => runtime);
  const service = new PiModelService(settingsService as any, modelRuntimeFactory as any);
  return { service, runtime, settingsService, modelRuntimeFactory };
}

beforeEach(() => {
  vi.clearAllMocks();
  sdkMocks.settingsManagerCreate.mockReturnValue({
    getDefaultProvider: vi.fn(() => 'openai'),
    getDefaultModel: vi.fn(() => 'gpt-test'),
    setDefaultModelAndProvider: vi.fn()
  });
});

describe('PiModelService ModelRuntime integration', () => {
  it('lazily creates one shared ModelRuntime for concurrent consumers', async () => {
    const { service, runtime, modelRuntimeFactory } = createService();

    expect(modelRuntimeFactory).not.toHaveBeenCalled();
    await expect(Promise.all([service.getModelRuntime(), service.getModelRuntime()])).resolves.toEqual([
      runtime,
      runtime
    ]);
    expect(modelRuntimeFactory).toHaveBeenCalledOnce();
  });

  it('reads models and auth state through the canonical Models API', async () => {
    const { service, runtime } = createService();

    const result = await service.listModels();

    expect(runtime.reloadConfig).toHaveBeenCalledOnce();
    expect(runtime.getModels).toHaveBeenCalledOnce();
    expect(runtime.getProviders).toHaveBeenCalledOnce();
    expect(runtime.checkAuth).toHaveBeenCalledWith('openai');
    expect(result).toMatchObject({
      models: [
        {
          provider: 'openai',
          providerName: 'OpenAI',
          id: 'gpt-test',
          authConfigured: true,
          isDefault: true
        }
      ],
      providers: [
        {
          provider: 'openai',
          providerName: 'OpenAI',
          authConfigured: true,
          authSource: 'stored credential',
          modelCount: 1
        }
      ],
      defaultModel: { provider: 'openai', modelId: 'gpt-test' }
    });
  });

  it('persists provider API keys through ModelRuntime login without reloading config again', async () => {
    const { service, runtime } = createService();
    runtime.login.mockImplementation(async (_provider, _type, interaction) => {
      const key = await interaction.prompt({ type: 'secret', message: 'Enter API key' });
      return { type: 'api_key', key };
    });

    await service.setProviderApiKey({ provider: 'openai', apiKey: ' sk-test ' });

    expect(runtime.login).toHaveBeenCalledWith('openai', 'api_key', expect.any(Object));
    await expect(runtime.login.mock.results[0]?.value).resolves.toEqual({ type: 'api_key', key: 'sk-test' });
    expect(runtime.reloadConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['amazon-bedrock', 'bearer-token'],
    ['google-vertex', 'api-key']
  ])('selects the single-key login method for %s', async (provider, expectedSelection) => {
    const { service, runtime } = createService();
    runtime.login.mockImplementation(async (_provider, _type, interaction) => {
      const selection = await interaction.prompt({
        type: 'select',
        message: 'Select authentication method',
        options: [
          { id: expectedSelection, label: 'Single key' },
          { id: 'other', label: 'Other method' }
        ]
      });
      const key = await interaction.prompt({ type: 'secret', message: 'Enter key' });
      return { type: 'api_key', key: `${selection}:${key}` };
    });

    await service.setProviderApiKey({ provider, apiKey: 'sk-test' });

    await expect(runtime.login.mock.results[0]?.value).resolves.toEqual({
      type: 'api_key',
      key: `${expectedSelection}:sk-test`
    });
  });

  it('rejects API-key login flows that require additional text fields', async () => {
    const { service, runtime } = createService();
    runtime.login.mockImplementation(async (_provider, _type, interaction) => {
      await interaction.prompt({ type: 'secret', message: 'Enter key' });
      await interaction.prompt({ type: 'text', message: 'Enter account ID' });
      return { type: 'api_key', key: 'unused' };
    });

    await expect(service.setProviderApiKey({ provider: 'cloudflare-workers-ai', apiKey: 'sk-test' })).rejects.toThrow(
      '需要额外认证信息'
    );
  });

  it('removes persistent provider credentials through ModelRuntime logout', async () => {
    const { service, runtime } = createService();

    await service.removeProviderAuth({ provider: 'openai' });

    expect(runtime.logout).toHaveBeenCalledWith('openai');
    expect(runtime.reloadConfig).not.toHaveBeenCalled();
  });

  it('serializes concurrent runtime reloads', async () => {
    const { service, runtime } = createService();
    let releaseFirstReload!: () => void;
    let markFirstReloadStarted!: () => void;
    const firstReloadStarted = new Promise<void>(resolve => {
      markFirstReloadStarted = resolve;
    });
    const firstReloadCanFinish = new Promise<void>(resolve => {
      releaseFirstReload = resolve;
    });
    runtime.reloadConfig
      .mockImplementationOnce(async () => {
        markFirstReloadStarted();
        await firstReloadCanFinish;
      })
      .mockResolvedValueOnce(undefined);

    const firstList = service.listModels();
    await firstReloadStarted;
    const secondList = service.listModels();
    await Promise.resolve();

    expect(runtime.reloadConfig).toHaveBeenCalledTimes(1);
    releaseFirstReload();
    await Promise.all([firstList, secondList]);
    expect(runtime.reloadConfig).toHaveBeenCalledTimes(2);
  });
});
