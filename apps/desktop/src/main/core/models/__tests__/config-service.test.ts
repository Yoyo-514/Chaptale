import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelConfigRepository } from '../config-repository';
import { CustomModelConfigService } from '../config-service';
import type { ModelsConfig } from '../config-types';

function cloneConfig(config: ModelsConfig): ModelsConfig {
  return JSON.parse(JSON.stringify(config)) as ModelsConfig;
}

function createRepository(initial: ModelsConfig = { providers: {} }) {
  let config = cloneConfig(initial);
  let transactionQueue = Promise.resolve();
  const repository = {
    read: vi.fn(async () => cloneConfig(config)),
    write: vi.fn(async (next: ModelsConfig) => {
      config = cloneConfig(next);
    }),
    update: vi.fn((mutator: (next: ModelsConfig) => void | Promise<void>) => {
      const operation = transactionQueue.then(async () => {
        const next = cloneConfig(config);
        await mutator(next);
        config = cloneConfig(next);
      });
      transactionQueue = operation.catch(() => undefined);
      return operation;
    }),
    findCustomModel: vi.fn((nextConfig: ModelsConfig, provider: string, modelId: string) => {
      const providerConfig = nextConfig.providers[provider];
      if (!providerConfig?.models?.length) {
        throw new Error(`未找到自定义供应商：${provider}`);
      }
      const model = providerConfig.models.find(item => item.id === modelId);
      if (!model) {
        throw new Error(`未找到自定义模型：${provider}/${modelId}`);
      }
      return model;
    })
  };

  return { repository, getConfig: () => config };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });

  return { promise, resolve };
}

describe('CustomModelConfigService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves fetch source from an existing provider or from a draft payload', async () => {
    const { repository } = createRepository({
      providers: {
        custom: { baseUrl: 'https://api.example.com', api: 'openai-responses', apiKey: 'sk-old', models: [] }
      }
    });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await expect(service.resolveFetchModelsSource({ provider: 'custom' })).resolves.toEqual({
      baseUrl: 'https://api.example.com',
      api: 'openai-responses',
      apiKey: 'sk-old'
    });
    await expect(
      service.resolveFetchModelsSource({
        baseUrl: ' https://draft.example.com ',
        api: 'anthropic-messages',
        apiKey: 'sk-draft'
      })
    ).resolves.toEqual({ baseUrl: 'https://draft.example.com', api: 'anthropic-messages', apiKey: 'sk-draft' });
    await expect(service.resolveFetchModelsSource({ provider: 'missing' })).rejects.toThrow(
      '未找到自定义供应商配置：missing'
    );
    await expect(service.resolveFetchModelsSource({ api: 'openai-responses' })).rejects.toThrow('Base URL 不能为空');
    await expect(service.resolveFetchModelsSource({ baseUrl: 'https://draft.example.com' })).rejects.toThrow(
      'API 类型不能为空'
    );
  });

  it('does not lose either update when concurrent service mutations start from the same snapshot', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-model-service-concurrency-'));
    const modelsPath = path.join(rootDir, 'agent', 'models.json');

    try {
      const repository = new ModelConfigRepository({ modelsPath });
      await repository.write({
        providers: {
          custom: {
            name: 'Custom',
            baseUrl: 'https://api.example.com',
            api: 'openai-responses',
            models: [{ id: 'model-a' }]
          }
        }
      });

      const originalRead = repository.read.bind(repository);
      const originalWrite = repository.write.bind(repository);
      const readsReady = createDeferred();
      let readCount = 0;
      let pendingWrite = Promise.resolve();

      vi.spyOn(repository, 'read').mockImplementation(async () => {
        const snapshot = await originalRead();
        readCount += 1;

        if (readCount === 2) {
          readsReady.resolve();
        }

        await readsReady.promise;
        return snapshot;
      });
      vi.spyOn(repository, 'write').mockImplementation(config => {
        const nextWrite = pendingWrite.then(() => originalWrite(config));
        pendingWrite = nextWrite.catch(() => undefined);
        return nextWrite;
      });

      const service = new CustomModelConfigService(repository);
      await Promise.all([
        service.addModel({ provider: 'custom', modelId: 'model-b', input: ['text'] }),
        service.setProviderApiKey({ provider: 'custom', apiKey: 'sk-concurrent' })
      ]);

      const finalConfig = await originalRead();
      expect(finalConfig.providers.custom.apiKey).toBe('sk-concurrent');
      expect(finalConfig.providers.custom.models?.map(model => model.id)).toEqual(['model-a', 'model-b']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('routes every mutation through update while keeping source resolution read-only', async () => {
    const { repository } = createRepository({
      providers: {
        custom: {
          name: 'Custom',
          baseUrl: 'https://api.example.com',
          api: 'openai-responses',
          models: [{ id: 'model-a' }]
        }
      }
    });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await service.addProvider({
      provider: 'custom',
      providerName: 'Custom',
      baseUrl: 'https://api.example.com',
      api: 'openai-responses',
      models: [{ modelId: 'model-a', input: ['text'] }]
    });
    await service.addModel({ provider: 'custom', modelId: 'model-b', input: ['text'] });
    await service.setProviderApiKey({ provider: 'custom', apiKey: 'sk-new' });
    await service.removeProviderApiKey({ provider: 'custom' });
    await service.updateModelInput({ provider: 'custom', modelId: 'model-b', input: ['image'] });
    await service.removeModel({ provider: 'custom', modelId: 'model-b' });

    expect(repository.update).toHaveBeenCalledTimes(6);
    expect(repository.write).not.toHaveBeenCalled();

    repository.read.mockClear();
    repository.update.mockClear();
    await service.resolveFetchModelsSource({ provider: 'custom' });

    expect(repository.read).toHaveBeenCalledOnce();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('adds or replaces a provider model while preserving provider defaults', async () => {
    const { repository, getConfig } = createRepository({
      providers: {
        custom: {
          name: 'Old Provider',
          baseUrl: 'https://old.example.com',
          api: 'openai-responses',
          apiKey: 'sk-old',
          headers: { 'X-Old': '1' },
          models: [{ id: 'old-model', name: 'Old Model' }]
        }
      }
    });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await service.addProvider({
      provider: ' custom ',
      providerName: ' Custom Provider ',
      baseUrl: ' https://new.example.com ',
      api: 'openai-responses',
      apiKey: ' ',
      models: [
        {
          modelId: ' new-model ',
          modelName: ' ',
          input: ['image'],
          contextWindow: 4096.8
        }
      ]
    });

    expect(getConfig().providers.custom).toEqual({
      name: 'Custom Provider',
      baseUrl: 'https://new.example.com',
      api: 'openai-responses',
      apiKey: 'sk-old',
      headers: { 'X-Old': '1' },
      models: [
        { id: 'old-model', name: 'Old Model' },
        { id: 'new-model', name: 'new-model', input: ['text', 'image'], contextWindow: 4096 }
      ]
    });
  });

  it('validates required provider and model fields', async () => {
    const { repository } = createRepository();
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);
    const basePayload = {
      provider: 'custom',
      providerName: 'Custom',
      baseUrl: 'https://api.example.com',
      api: 'openai-responses' as const,
      models: [{ modelId: 'model-a', input: ['text' as const] }]
    };

    await expect(service.addProvider({ ...basePayload, providerName: ' ' })).rejects.toThrow('供应商名称不能为空');
    await expect(service.addProvider({ ...basePayload, baseUrl: ' ' })).rejects.toThrow('Base URL 不能为空');
    await expect(service.addProvider({ ...basePayload, models: [{ modelId: ' ', input: ['text'] }] })).rejects.toThrow(
      '模型 ID 不能为空'
    );
    await expect(
      service.addProvider({ ...basePayload, models: [{ modelId: 'model-a', input: ['text'], contextWindow: 0 }] })
    ).rejects.toThrow('Context Window 必须是大于 0 的数字');
  });

  it('adds models, updates input capabilities, and manages provider api keys', async () => {
    const { repository, getConfig } = createRepository({
      providers: {
        custom: {
          name: 'Custom',
          baseUrl: 'https://api.example.com',
          api: 'openai-responses',
          models: [{ id: 'model-a' }]
        }
      }
    });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await service.addModel({
      provider: 'custom',
      modelId: 'model-b',
      modelName: 'Model B',
      input: ['image'],
      contextWindow: 8192
    });
    await service.updateModelInput({ provider: 'custom', modelId: 'model-b', input: ['text'] });
    await service.setProviderApiKey({ provider: 'custom', apiKey: ' sk-new ' });
    expect(getConfig().providers.custom.models).toEqual([
      { id: 'model-a' },
      { id: 'model-b', name: 'Model B', input: ['text'], contextWindow: 8192 }
    ]);
    expect(getConfig().providers.custom.apiKey).toBe('sk-new');

    await service.removeProviderApiKey({ provider: 'custom' });
    expect(getConfig().providers.custom.apiKey).toBeUndefined();
  });

  it('removes models and deletes the provider when the last model is removed', async () => {
    const { repository, getConfig } = createRepository({
      providers: {
        custom: { name: 'Custom', models: [{ id: 'model-a' }, { id: 'model-b' }] },
        overridden: { name: 'Overridden', modelOverrides: { keep: {} }, models: [{ id: 'model-c' }] }
      }
    });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await service.removeModel({ provider: 'custom', modelId: 'model-a' });
    expect(getConfig().providers.custom.models).toEqual([{ id: 'model-b' }]);

    await service.removeModel({ provider: 'custom', modelId: 'model-b' });
    expect(getConfig().providers.custom).toBeUndefined();

    await service.removeModel({ provider: 'overridden', modelId: 'model-c' });
    expect(getConfig().providers.overridden).toMatchObject({ modelOverrides: { keep: {} }, models: [] });
  });

  it('throws user-readable errors when custom provider or model is missing', async () => {
    const { repository } = createRepository({ providers: { custom: { name: 'Custom', models: [{ id: 'model-a' }] } } });
    const service = new CustomModelConfigService(repository as unknown as ModelConfigRepository);

    await expect(service.addModel({ provider: 'missing', modelId: 'model-a', input: ['text'] })).rejects.toThrow(
      '未找到自定义供应商：missing'
    );
    await expect(service.setProviderApiKey({ provider: 'missing', apiKey: 'sk' })).rejects.toThrow(
      '未找到自定义供应商：missing'
    );
    await expect(service.setProviderApiKey({ provider: 'custom', apiKey: ' ' })).rejects.toThrow('API Key 不能为空');
    await expect(service.removeProviderApiKey({ provider: 'missing' })).rejects.toThrow('未找到自定义供应商：missing');
    await expect(service.updateModelInput({ provider: 'custom', modelId: 'missing', input: ['text'] })).rejects.toThrow(
      '未找到自定义模型：custom/missing'
    );
    await expect(service.removeModel({ provider: 'custom', modelId: 'missing' })).rejects.toThrow(
      '未找到自定义模型：custom/missing'
    );
  });
});
