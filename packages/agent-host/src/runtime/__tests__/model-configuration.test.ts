import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { NativeProvider } from '../../protocol/index.ts';
import { HostModelConfiguration } from '../model-configuration.ts';
import { createHostModelRuntime } from '../model-runtime.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const provider: NativeProvider = {
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  headers: { 'X-Team': 'chaptale' },
  compat: { supportsDeveloperRole: false },
  models: [
    { id: 'first-model', name: '第一个模型', contextWindow: 8192, maxTokens: 512, input: ['text', 'image'] },
    { id: 'second-model', reasoning: true }
  ]
};

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'chaptale-model-config-'));
  directories.push(directory);
  const runtime = await createHostModelRuntime({ configDir: directory });
  return { directory, runtime, configuration: new HostModelConfiguration(directory, runtime) };
}

const nativeFile = (directory: string) => readFile(join(directory, 'models.json'), 'utf8');

it('供应商按 pi 原生格式整体保存，重开后可用，列表保留高级字段且不回传密钥', async () => {
  const { directory, configuration } = await setup();
  await configuration.save({ id: 'configured', config: provider, apiKey: 'offline-test-key' });
  await configuration.save({ id: 'configured', config: { ...provider, headers: undefined } });

  const reopened = await createHostModelRuntime({ configDir: directory });
  expect(
    reopened
      .getAvailableSnapshot()
      .filter(model => model.provider === 'configured')
      .map(model => model.id)
  ).toEqual(['first-model', 'second-model']);
  expect(JSON.parse(await nativeFile(directory)).providers.configured.apiKey).toBe('offline-test-key');
  const listed = await new HostModelConfiguration(directory, reopened).list();
  const { headers: _, ...withoutHeaders } = provider;
  expect(listed).toEqual([{ id: 'configured', hasApiKey: true, config: withoutHeaders }]);
  expect(JSON.stringify(listed)).not.toContain('offline-test-key');
});

it('删除供应商后运行时立即移除其模型，其他供应商保持不变', async () => {
  const { directory, runtime, configuration } = await setup();
  await configuration.save({ id: 'kept', config: provider, apiKey: 'key' });
  await configuration.save({ id: 'removed', config: provider, apiKey: 'key' });
  await configuration.remove('removed');
  expect(new Set(runtime.getAvailableSnapshot().map(model => model.provider))).toEqual(new Set(['kept']));
  expect(Object.keys(JSON.parse(await nativeFile(directory)).providers)).toEqual(['kept']);
});

it('原生空供应商配置可从界面添加', async () => {
  const { directory, runtime } = await setup();
  await writeFile(join(directory, 'models.json'), '{"providers":{}}\n');
  await new HostModelConfiguration(directory, runtime).save({ id: 'added', config: provider, apiKey: 'key' });
  expect(runtime.getAvailableSnapshot().map(model => model.id)).toEqual(['first-model', 'second-model']);
});

it('拒绝无效地址、密钥与原生校验失败的配置，失败后保留原文件与可用模型', async () => {
  const { directory, runtime, configuration } = await setup();
  await configuration.save({ id: 'configured', config: provider, apiKey: 'key' });
  const before = await nativeFile(directory);

  await expect(
    configuration.save({ id: 'configured', config: { ...provider, baseUrl: 'file:///private' } })
  ).rejects.toThrow('地址');
  await expect(configuration.save({ id: 'configured', config: provider, apiKey: '!echo key' })).rejects.toThrow('密钥');
  await expect(configuration.save({ id: 'configured', config: { ...provider, apiKey: 'inline' } })).rejects.toThrow(
    '密钥'
  );
  await expect(
    configuration.save({ id: 'configured', config: { ...provider, models: [{ id: 'bad', maxTokens: 0 }] } })
  ).rejects.toThrow('已恢复原配置');

  expect(await nativeFile(directory)).toBe(before);
  expect(runtime.getAvailableSnapshot().map(model => model.id)).toEqual(['first-model', 'second-model']);
});

it('按表单连接拉取模型列表，未填密钥时使用已保存的凭据', async () => {
  const requests: { url?: string; authorization?: string; team?: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      team: request.headers['x-team'] as string
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'remote-a' }, { id: 'models/remote-b', displayName: '远端 B' }, {}] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { configuration } = await setup();
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
    await configuration.save({ id: 'local', config: { ...provider, baseUrl }, apiKey: 'stored-key' });

    const models = await configuration.discover({
      id: 'local',
      baseUrl,
      api: 'openai-completions',
      headers: provider.headers
    });
    expect(models).toEqual([
      { id: 'remote-a', name: 'remote-a' },
      { id: 'remote-b', name: '远端 B' }
    ]);
    await configuration.discover({ baseUrl, api: 'openai-completions', apiKey: 'typed-key' });
    expect(requests).toEqual([
      { url: '/v1/models', authorization: 'Bearer stored-key', team: 'chaptale' },
      { url: '/v1/models', authorization: 'Bearer typed-key', team: undefined }
    ]);
    await expect(configuration.discover({ baseUrl, api: 'anthropic-messages' })).rejects.toThrow('模型列表');
  } finally {
    server.close();
  }
});
