import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelConfigRepository } from '../config-repository';

let dir: string;
let modelsPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-models-repo-'));
  modelsPath = path.join(dir, 'agent', 'models.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('defaultModel 迁移与读写', () => {
  it('无 defaultModel 时读取 undefined；设置后持久化', async () => {
    const repository = new ModelConfigRepository({ modelsPath });

    await expect(repository.getDefaultModel()).resolves.toBeUndefined();

    await repository.setDefaultModel({ provider: 'deepseek', modelId: 'deepseek-chat' });

    await expect(repository.getDefaultModel()).resolves.toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-chat'
    });
  });

  it('setDefaultModel(undefined) 清除默认模型', async () => {
    const repository = new ModelConfigRepository({ modelsPath });

    await repository.setDefaultModel({ provider: 'deepseek', modelId: 'deepseek-chat' });
    await repository.setDefaultModel(undefined);

    await expect(repository.getDefaultModel()).resolves.toBeUndefined();
  });

  it('defaultModel 与 providers 同文件持久化（单一事实源）', async () => {
    const repository = new ModelConfigRepository({ modelsPath });

    await repository.update(config => {
      config.providers['deepseek'] = { name: 'DeepSeek', models: [{ id: 'deepseek-chat' }] };
    });
    await repository.setDefaultModel({ provider: 'deepseek', modelId: 'deepseek-chat' });

    const config = await repository.read();

    expect(config.providers).toHaveProperty('deepseek');
    expect(config.defaultModel).toEqual({ provider: 'deepseek', modelId: 'deepseek-chat' });
  });
});
