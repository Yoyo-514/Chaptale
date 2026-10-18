import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { ProviderInput } from '../../protocol.ts';
import { HostModelConfiguration } from '../model-configuration.ts';
import { createHostModelRuntime } from '../model-runtime.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const input: ProviderInput = {
  provider: 'configured-provider',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  modelId: 'first-model',
  modelName: '第一个模型',
  contextWindow: 8192,
  maxTokens: 512,
  reasoning: false,
  apiKey: 'offline-test-key'
};

it('配置使用 pi 原生格式保存，重开后两个模型和凭据仍可用，省略凭据时保留已有值', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaptale-model-config-'));
  directories.push(directory);
  const runtime = await createHostModelRuntime({ configDir: directory });
  const configuration = new HostModelConfiguration(directory, runtime);
  await configuration.save(input);
  await configuration.save({ ...input, modelId: 'second-model', modelName: '第二个模型', apiKey: undefined });
  const reopened = await createHostModelRuntime({ configDir: directory });
  expect(
    reopened
      .getAvailableSnapshot()
      .filter(model => model.provider === input.provider)
      .map(model => model.id)
  ).toEqual(['first-model', 'second-model']);
  expect(await reopened.getAuth(input.provider)).toBeDefined();
  const native = JSON.parse(await readFile(join(directory, 'models.json'), 'utf8'));
  expect(native.providers[input.provider].apiKey).toBe('offline-test-key');
  expect(native.providers[input.provider].models).toHaveLength(2);
});

it('原生空供应商配置可从界面添加模型', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaptale-model-config-'));
  directories.push(directory);
  await writeFile(join(directory, 'models.json'), '{"providers":{}}\n');
  const runtime = await createHostModelRuntime({ configDir: directory });
  await new HostModelConfiguration(directory, runtime).save(input);
  expect(
    runtime
      .getAvailableSnapshot()
      .filter(model => model.provider === input.provider)
      .map(model => model.id)
  ).toEqual(['first-model']);
});

it('拒绝无效地址和 token 参数，配置失败保留原配置', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaptale-model-config-'));
  directories.push(directory);
  const runtime = await createHostModelRuntime({ configDir: directory });
  const configuration = new HostModelConfiguration(directory, runtime);
  await configuration.save(input);
  const before = await readFile(join(directory, 'models.json'), 'utf8');
  await expect(configuration.save({ ...input, baseUrl: 'file:///private' })).rejects.toThrow('地址');
  await expect(configuration.save({ ...input, maxTokens: 0 })).rejects.toThrow('token');
  expect(await readFile(join(directory, 'models.json'), 'utf8')).toBe(before);
});
