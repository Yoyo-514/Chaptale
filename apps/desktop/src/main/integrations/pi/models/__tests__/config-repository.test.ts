import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiModelConfigRepository } from '../config-repository';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile)
  };
});

let rootDir: string;
let modelsPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
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

  it('keeps the old file and cleans the temp file when atomic rename fails', async () => {
    const oldContent = '{\n  "providers": { "old": {} }\n}\n';
    await mkdir(path.dirname(modelsPath), { recursive: true });
    await writeFile(modelsPath, oldContent, 'utf8');
    vi.mocked(writeFile).mockClear();
    vi.mocked(rename).mockClear();
    vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    const onWrite = vi.fn();
    const repository = new PiModelConfigRepository({ modelsPath, onWrite });

    await expect(repository.write({ providers: { next: {} } })).rejects.toThrow('rename failed');

    expect(await readFile(modelsPath, 'utf8')).toBe(oldContent);
    expect(onWrite).not.toHaveBeenCalled();
    expect(await readdir(path.dirname(modelsPath))).toEqual(['models.json']);
    const [tempPath, targetPath] = vi.mocked(rename).mock.calls[0];
    expect(path.dirname(tempPath.toString())).toBe(path.dirname(modelsPath));
    expect(tempPath).not.toBe(modelsPath);
    expect(targetPath).toBe(modelsPath);
  });

  it('keeps the old file and cleans the temp path when writing the temp file fails', async () => {
    const oldContent = '{\n  "providers": { "old": {} }\n}\n';
    await mkdir(path.dirname(modelsPath), { recursive: true });
    await writeFile(modelsPath, oldContent, 'utf8');
    vi.mocked(writeFile).mockClear();
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('temp write failed'));
    const onWrite = vi.fn();
    const repository = new PiModelConfigRepository({ modelsPath, onWrite });

    await expect(repository.write({ providers: { next: {} } })).rejects.toThrow('temp write failed');

    const [tempPath] = vi.mocked(writeFile).mock.calls[0];
    expect(path.dirname(tempPath.toString())).toBe(path.dirname(modelsPath));
    expect(tempPath).not.toBe(modelsPath);
    expect(await readFile(modelsPath, 'utf8')).toBe(oldContent);
    expect(onWrite).not.toHaveBeenCalled();
    expect(await readdir(path.dirname(modelsPath))).toEqual(['models.json']);
  });

  it('uses a different same-directory temp file for every replacement', async () => {
    const repository = new PiModelConfigRepository({ modelsPath });

    await repository.write({ providers: { first: {} } });
    await repository.write({ providers: { second: {} } });

    const renameCalls = vi.mocked(rename).mock.calls;
    expect(renameCalls).toHaveLength(2);
    expect(renameCalls[0][0]).not.toBe(renameCalls[1][0]);
    expect(renameCalls.every(([tempPath]) => path.dirname(tempPath.toString()) === path.dirname(modelsPath))).toBe(
      true
    );
    expect(renameCalls.every(([, targetPath]) => targetPath === modelsPath)).toBe(true);
  });

  it('serializes updates and continues after a rejected transaction', async () => {
    const repository = new PiModelConfigRepository({ modelsPath });
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      firstEntered = resolve;
    });
    const firstCanFinish = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let secondEntered = false;

    const firstUpdate = repository.update(async config => {
      config.providers.first = {};
      firstEntered();
      await firstCanFinish;
      throw new Error('transaction failed');
    });
    const firstFailure = expect(firstUpdate).rejects.toThrow('transaction failed');
    await firstStarted;

    const secondUpdate = repository.update(config => {
      secondEntered = true;
      config.providers.second = {};
    });
    await Promise.resolve();
    expect(secondEntered).toBe(false);

    releaseFirst();
    await firstFailure;
    await expect(secondUpdate).resolves.toBeUndefined();
    await expect(repository.read()).resolves.toEqual({ providers: { second: {} } });
  });

  it('queues updates behind an in-flight public write', async () => {
    const repository = new PiModelConfigRepository({ modelsPath });
    let renameStarted!: () => void;
    let releaseRename!: () => void;
    const atRename = new Promise<void>(resolve => {
      renameStarted = resolve;
    });
    const canRename = new Promise<void>(resolve => {
      releaseRename = resolve;
    });
    vi.mocked(rename).mockImplementationOnce(async () => {
      renameStarted();
      await canRename;
    });

    const publicWrite = repository.write({ providers: { written: {} } });
    await atRename;
    vi.mocked(readFile).mockClear();
    let updateEntered = false;

    const update = repository.update(config => {
      updateEntered = true;
      config.providers.updated = {};
    });
    await Promise.resolve();

    expect(readFile).not.toHaveBeenCalled();
    expect(updateEntered).toBe(false);

    releaseRename();
    await publicWrite;
    await update;
    await expect(repository.read()).resolves.toEqual({ providers: { updated: {} } });
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
