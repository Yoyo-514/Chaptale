import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelsConfig } from '../config-types';
import { ModelService } from '../service';

let dir: string;
let modelsPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-model-service-'));
  modelsPath = path.join(dir, 'models.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function createConfig(): ModelsConfig {
  return {
    providers: {
      deepseek: {
        name: 'DeepSeek',
        api: 'openai-completions',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-key',
        models: [{ id: 'deepseek-chat', contextWindow: 64_000 }]
      },
      'no-key': {
        name: '未配 Key',
        api: 'openai-completions',
        baseUrl: 'https://api.example.com/v1',
        models: [{ id: 'm1' }]
      }
    }
  };
}

async function createService() {
  const config = createConfig();
  await writeFile(modelsPath, JSON.stringify(config), 'utf8');
  return new ModelService({ modelsPath });
}

describe('ModelService.listModels', () => {
  it('只含自定义 providers；authConfigured = apiKey 存在性；排序未配 Key 在后', async () => {
    const service = await createService();

    const result = await service.listModels();

    expect(result.models).toHaveLength(2);
    expect(result.models.every(model => model.isCustom)).toBe(true);

    const deepseek = result.models.find(model => model.provider === 'deepseek');
    expect(deepseek).toMatchObject({
      id: 'deepseek-chat',
      providerName: 'DeepSeek',
      contextWindow: 64_000,
      authConfigured: true,
      isDefault: false
    });

    expect(result.providers.map(provider => provider.provider)).toEqual(['deepseek', 'no-key']);
    expect(result.providers[1]).toMatchObject({ authConfigured: false, modelCount: 1 });
  });

  it('defaultModel 存在时标记 isDefault 且顶层返回', async () => {
    const service = await createService();

    await service.setDefaultModel({ provider: 'deepseek', modelId: 'deepseek-chat' });
    const result = await service.listModels();

    expect(result.defaultModel).toEqual({ provider: 'deepseek', modelId: 'deepseek-chat' });
    expect(result.models.find(model => model.provider === 'deepseek')?.isDefault).toBe(true);
  });

  it('setDefaultModel 校验模型存在性', async () => {
    const service = await createService();

    await expect(service.setDefaultModel({ provider: 'deepseek', modelId: 'ghost' })).rejects.toThrow(
      '未找到模型：deepseek/ghost'
    );
  });

  it('removeCustomModel 同步清除指向自身的默认模型', async () => {
    const service = await createService();

    await service.setDefaultModel({ provider: 'deepseek', modelId: 'deepseek-chat' });
    // no-key 只有一个模型；删除 deepseek-chat 使默认模型悬空。
    await service.removeCustomModel({ provider: 'deepseek', modelId: 'deepseek-chat' });

    const result = await service.listModels();

    expect(result.defaultModel).toBeUndefined();
    expect(result.models.some(model => model.provider === 'deepseek')).toBe(false);
  });
});

describe('ModelService.checkAuth 三态', () => {
  it('缺 provider / 缺 key → false（未配置）', async () => {
    const service = await createService();

    await expect(service.checkAuth('ghost')).resolves.toBe(false);
    await expect(service.checkAuth('no-key')).resolves.toBe(false);
  });

  it('anthropic-messages → undefined（无列表接口，无法探测）', async () => {
    const service = await createService();
    await service.addCustomProvider({
      provider: 'anthropic-mirror',
      providerName: 'Claude Mirror',
      baseUrl: 'https://mirror.example.com',
      api: 'anthropic-messages',
      models: []
    });
    await service.setCustomProviderApiKey({ provider: 'anthropic-mirror', apiKey: 'sk-x' });

    await expect(service.checkAuth('anthropic-mirror')).resolves.toBe(undefined);
  });

  it('探测成功 → true；HTTP 401/403 → false；网络错误 → undefined', async () => {
    const service = await createService();

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }), { status: 200 }));
    await expect(service.checkAuth('deepseek')).resolves.toBe(true);

    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(service.checkAuth('deepseek')).resolves.toBe(false);

    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(service.checkAuth('deepseek')).resolves.toBe(false);

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(service.checkAuth('deepseek')).resolves.toBe(undefined);
  });
});

describe('pi 面兼容方法', () => {
  it('setProviderApiKey / removeProviderAuth 收敛为 models.json 操作', async () => {
    const service = await createService();

    await service.setProviderApiKey({ provider: 'no-key', apiKey: 'sk-legacy' });
    expect((await service.listModels()).providers.find(p => p.provider === 'no-key')?.authConfigured).toBe(true);

    await service.removeProviderAuth({ provider: 'no-key' });
    expect((await service.listModels()).providers.find(p => p.provider === 'no-key')?.authConfigured).toBe(false);
  });
});
