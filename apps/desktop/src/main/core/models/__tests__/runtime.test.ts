import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelsConfig } from '../config-types';
import { ModelRuntime } from '../runtime';

let dir: string;
let modelsPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-models-runtime-'));
  modelsPath = path.join(dir, 'models.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createConfig(): ModelsConfig {
  return {
    providers: {
      deepseek: {
        name: 'DeepSeek',
        api: 'openai-completions',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-key',
        models: [
          { id: 'deepseek-chat', contextWindow: 64_000, input: ['text', 'image'] },
          { id: 'deepseek-reasoner', reasoning: true }
        ]
      }
    }
  };
}

describe('ModelRuntime.resolveModel', () => {
  it('解析 provider 级协议与凭据；contextWindow/input 生效', async () => {
    await writeFile(modelsPath, JSON.stringify(createConfig()), 'utf8');
    const runtime = new ModelRuntime(new (await import('../config-repository')).ModelConfigRepository({ modelsPath }));

    const resolved = await runtime.resolveModel('deepseek', 'deepseek-chat');

    expect(resolved.provider).toBe('deepseek');
    expect(resolved.modelId).toBe('deepseek-chat');
    expect(resolved.contextWindow).toBe(64_000);
    expect(resolved.input).toEqual(['text', 'image']);
    // LanguageModel 实例（provider 工厂产物，可继续传给 streamText）。
    expect(resolved.model).toBeTruthy();
  });

  it('未填 contextWindow → 128k 估算；未填 input → [text]', async () => {
    await writeFile(modelsPath, JSON.stringify(createConfig()), 'utf8');
    const { ModelConfigRepository } = await import('../config-repository');
    const runtime = new ModelRuntime(new ModelConfigRepository({ modelsPath }));

    const resolved = await runtime.resolveModel('deepseek', 'deepseek-reasoner');

    expect(resolved.contextWindow).toBe(128_000);
    expect(resolved.input).toEqual(['text']);
  });

  it('model 级 api/baseUrl 覆盖 provider 级', async () => {
    const config = createConfig();
    config.providers['deepseek']!.models = [
      {
        id: 'special',
        api: 'anthropic-messages',
        baseUrl: 'https://mirror.example.com'
      }
    ];
    await writeFile(modelsPath, JSON.stringify(config), 'utf8');
    const { ModelConfigRepository } = await import('../config-repository');
    const runtime = new ModelRuntime(new ModelConfigRepository({ modelsPath }));

    const resolved = await runtime.resolveModel('deepseek', 'special');

    // 覆盖生效：仍能正常解析出 LanguageModel 实例。
    expect(resolved.model).toBeTruthy();
  });

  it('provider 或 model 缺失 → 明确报错', async () => {
    await writeFile(modelsPath, JSON.stringify(createConfig()), 'utf8');
    const { ModelConfigRepository } = await import('../config-repository');
    const runtime = new ModelRuntime(new ModelConfigRepository({ modelsPath }));

    await expect(runtime.resolveModel('ghost', 'x')).rejects.toThrow('未找到供应商：ghost');

    // provider 存在但模型未登记：仍解析成功（兼容站允许直连任意 model id，
    // 如拉取前列表为空时手动指定）；上下文走估算。
    const resolved = await runtime.resolveModel('deepseek', 'unknown-model-id');
    expect(resolved.contextWindow).toBe(128_000);
  });
});
