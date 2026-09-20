import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { version } from '../../../../../package.json';
import { ModelConfigRepository } from '../config-repository';
import { CustomModelConfigService } from '../config-service';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'chaptale-user-agent-'));
});
afterEach(async () => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^chaptale-user-agent-/);
  await rm(directory, { recursive: true, force: true });
});

describe('模型配置的应用请求标识', () => {
  const official = `Chaptale/${version} (+https://github.com/Yoyo-514/Chaptale)`;
  it.each<{ headers: Record<string, string> | undefined; expected: Record<string, string> }>([
    { headers: undefined, expected: { 'User-Agent': official } },
    { headers: {}, expected: { 'User-Agent': official } },
    { headers: { 'X-Custom': 'value' }, expected: { 'X-Custom': 'value', 'User-Agent': official } },
    { headers: { 'User-Agent': 'Chaptale/1.5.0' }, expected: { 'User-Agent': official } },
    {
      headers: { 'user-agent': 'Chaptale/0.0.1 (+https://github.com/Yoyo-514/Chaptale)' },
      expected: { 'user-agent': official }
    },
    {
      headers: { 'user-agent': 'CustomClient/2.0', 'X-Custom': 'value' },
      expected: { 'user-agent': 'CustomClient/2.0', 'X-Custom': 'value' }
    }
  ])('保存时补齐默认标识或保留自定义标识：$headers', async ({ headers, expected }) => {
    const modelsPath = path.join(directory, 'models.json');
    const repository = new ModelConfigRepository({ modelsPath });
    if (headers) await repository.write({ providers: { custom: { headers } } });
    const service = new CustomModelConfigService(repository);
    await service.addProvider({
      provider: 'custom',
      providerName: 'Custom',
      baseUrl: 'https://api.example.com',
      api: 'openai-responses',
      models: [{ modelId: 'example', input: ['text'] }]
    });
    const stored = JSON.parse(await readFile(modelsPath, 'utf8'));
    expect(stored.providers.custom.headers).toEqual(expected);
  });
});
