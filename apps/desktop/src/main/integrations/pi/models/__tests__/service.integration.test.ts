import { ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiModelService } from '../service';

let rootDir: string;

beforeEach(async () => {
  // create({ allowModelNetwork: false }) 只约束初始化刷新；login/logout 仍读取 PI_OFFLINE。
  // 测试必须固定整个 ModelRuntime 生命周期为离线，避免凭据写入触发真实目录刷新网络请求。
  vi.stubEnv('PI_OFFLINE', '1');
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-model-runtime-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(rootDir, { recursive: true, force: true });
});

describe('PiModelService credential persistence', () => {
  it('persists and removes provider API keys through the real ModelRuntime credential store', async () => {
    const agentDir = path.join(rootDir, 'agent');
    const authPath = path.join(agentDir, 'auth.json');
    const modelsPath = path.join(agentDir, 'models.json');
    const modelRuntime = await ModelRuntime.create({
      authPath,
      modelsPath,
      allowModelNetwork: false
    });
    const settingsService = {
      agentDir,
      piAuthPath: authPath,
      piModelsPath: modelsPath,
      getCurrentCwd: async () => rootDir
    };
    const service = new PiModelService(settingsService as any, async () => modelRuntime);

    await service.setProviderApiKey({ provider: 'openai', apiKey: ' sk-persisted ' });
    expect(readStoredCredential('openai', authPath)).toEqual({ type: 'api_key', key: 'sk-persisted' });

    await service.removeProviderAuth({ provider: 'openai' });
    expect(readStoredCredential('openai', authPath)).toBeUndefined();
  });

  it('reloads local model config without a network refresh after writes', async () => {
    const agentDir = path.join(rootDir, 'agent');
    const authPath = path.join(agentDir, 'auth.json');
    const modelsPath = path.join(agentDir, 'models.json');
    const modelRuntime = await ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false });
    const refresh = vi.spyOn(modelRuntime, 'refresh');
    const settingsService = {
      agentDir,
      piAuthPath: authPath,
      piModelsPath: modelsPath,
      getCurrentCwd: async () => rootDir
    };
    const service = new PiModelService(settingsService as any, async () => modelRuntime);

    const result = await service.addCustomProvider({
      provider: 'custom',
      providerName: 'Custom',
      baseUrl: 'https://api.example.com',
      api: 'openai-responses',
      models: [{ modelId: 'model-a', input: ['text'] }]
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: false });
    expect(result.models).toContainEqual(
      expect.objectContaining({ provider: 'custom', id: 'model-a', isCustom: true })
    );
  });
});
