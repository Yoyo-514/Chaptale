import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_WEB_TOOLS_SETTINGS, WebToolsSettingsStore, normalizeSettings } from '../settings';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempStore(initial?: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-tools-settings-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, 'web-tools.json');

  if (initial !== undefined) {
    await fs.writeFile(configPath, JSON.stringify(initial), 'utf8');
  }

  return new WebToolsSettingsStore({ configPath });
}

describe('normalizeSettings', () => {
  it('空对象回填全部默认值', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_WEB_TOOLS_SETTINGS);
  });

  it('非对象输入回退默认值', () => {
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_WEB_TOOLS_SETTINGS);
  });

  it('提取已知键并忽略未知字段', () => {
    const settings = normalizeSettings({
      version: 1,
      search: { provider: 'brave', extra: true },
      keys: { braveApiKey: ' x ', tavilyApiKey: '', exaApiKey: 'k' },
      fetch: { timeoutSeconds: 10, maxBytes: 1024 },
      ssrf: { allowRanges: ['10.0.0.0/8'] },
      unknown: { nested: 1 }
    });

    expect(settings).toEqual({
      search: { enabled: true, provider: 'brave' },
      keys: { braveApiKey: 'x', tavilyApiKey: undefined, exaApiKey: 'k' },
      fetch: { timeoutSeconds: 10, maxBytes: 1024 },
      ssrf: { allowRanges: ['10.0.0.0/8'] }
    });
  });

  it('非法 provider 枚举回退 duckduckgo', () => {
    expect(normalizeSettings({ search: { provider: 'google' } }).search.provider).toBe('duckduckgo');
    expect(normalizeSettings({ search: { provider: 42 } }).search.provider).toBe('duckduckgo');
  });
});

describe('WebToolsSettingsStore', () => {
  it('文件缺失时返回默认配置', async () => {
    const store = await createTempStore();
    expect(await store.read()).toEqual(DEFAULT_WEB_TOOLS_SETTINGS);
  });

  it('坏文件返回默认配置（不抛错）', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-tools-broken-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, 'web-tools.json');
    await fs.writeFile(configPath, '{ broken json', 'utf8');

    const store = new WebToolsSettingsStore({ configPath });
    expect(await store.read()).toEqual(DEFAULT_WEB_TOOLS_SETTINGS);
  });

  it('write 后 read 往返一致（含 version 字段）', async () => {
    const store = await createTempStore();
    const next = normalizeSettings({ search: { provider: 'tavily' }, keys: { tavilyApiKey: 'tk' } });

    await store.write(next);
    expect(await store.read()).toEqual(next);
  });

  it('update 基于最新配置变更', async () => {
    const store = await createTempStore();
    const next = await store.update(current => ({
      ...current,
      ssrf: { ...current.ssrf, allowRanges: ['172.16.0.0/12'] }
    }));

    expect(next.ssrf.allowRanges).toEqual(['172.16.0.0/12']);
    expect((await store.read()).ssrf.allowRanges).toEqual(['172.16.0.0/12']);
  });

  it('configPathFor 拼接 agentDir 下的文件名', () => {
    expect(WebToolsSettingsStore.configPathFor(path.join('root', 'agent'))).toBe(
      path.join('root', 'agent', 'web-tools.json')
    );
  });
});
