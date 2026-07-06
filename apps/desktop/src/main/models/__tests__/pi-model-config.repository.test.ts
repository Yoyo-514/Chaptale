import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiModelConfigRepository } from '../pi-model-config.repository';

let rootDir: string;
let modelsPath: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-model-config-'));
  modelsPath = path.join(rootDir, 'agent', 'models.json');
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('PiModelConfigRepository', () => {
  it('returns an empty provider map when models.json does not exist', async () => {
    const repository = new PiModelConfigRepository({ modelsPath });

    await expect(repository.read()).resolves.toEqual({ providers: {} });
  });

  it('reads models.json with comments and extracts custom model keys', async () => {
    await mkdir(path.dirname(modelsPath), { recursive: true });
    await writeFile(
      modelsPath,
      `{
        // custom provider
        "providers": {
          "custom": {
            "models": [{ "id": "model-a" }, { "id": "model-b" }]
          }
        }
      }`,
      'utf8'
    );
    const repository = new PiModelConfigRepository({ modelsPath });

    await expect(repository.read()).resolves.toEqual({
      providers: { custom: { models: [{ id: 'model-a' }, { id: 'model-b' }] } }
    });
    await expect(repository.getCustomModelKeys()).resolves.toEqual(new Set(['custom:model-a', 'custom:model-b']));
  });

  it('writes config, creates parent directories, and notifies the registry refresh hook', async () => {
    const onWrite = vi.fn();
    const repository = new PiModelConfigRepository({ modelsPath, onWrite });

    await repository.write({ providers: { custom: { name: 'Custom', models: [{ id: 'model-a' }] } } });

    await expect(repository.read()).resolves.toEqual({
      providers: { custom: { name: 'Custom', models: [{ id: 'model-a' }] } }
    });
    expect(onWrite).toHaveBeenCalled();
  });

  it('validates malformed models.json and gracefully handles key extraction failures', async () => {
    const repository = new PiModelConfigRepository({ modelsPath });

    await mkdir(path.dirname(modelsPath), { recursive: true });
    await writeFile(modelsPath, '{ "providers": [] }', 'utf8');
    await expect(repository.read()).rejects.toThrow('models.json 的 providers 必须是对象');
    await expect(repository.getCustomModelKeys()).resolves.toEqual(new Set());

    await writeFile(modelsPath, '{ "models": [] }', 'utf8');
    await expect(repository.read()).rejects.toThrow('models.json 必须包含 providers 对象');
  });

  it('finds custom models and reports missing provider or model errors', () => {
    const repository = new PiModelConfigRepository({ modelsPath });
    const config = { providers: { custom: { models: [{ id: 'model-a' }] } } };

    expect(repository.findCustomModel(config, 'custom', 'model-a')).toEqual({ id: 'model-a' });
    expect(() => repository.findCustomModel(config, 'missing', 'model-a')).toThrow('未找到自定义供应商：missing');
    expect(() => repository.findCustomModel(config, 'custom', 'missing')).toThrow('未找到自定义模型：custom/missing');
  });
});
