import { describe, expect, it } from 'vitest';

import type { WebToolsSettings } from '@chaptale/ipc-contract';

import {
  createDefaultWebToolsSettings,
  normalizeWebToolsSettings,
  webToolsProviders
} from '../../utils/web-tools-settings';

describe('webToolsProviders', () => {
  it('四个 provider：duckduckgo 默认且标注无需 Key', () => {
    expect(webToolsProviders.map(provider => provider.value)).toEqual(['duckduckgo', 'brave', 'tavily', 'exa']);
    expect(webToolsProviders[0]?.note).toContain('无需');
  });
});

describe('createDefaultWebToolsSettings', () => {
  it('默认启用搜索且 provider 为 duckduckgo', () => {
    const settings = createDefaultWebToolsSettings();

    expect(settings.search).toEqual({ enabled: true, provider: 'duckduckgo' });
    expect(settings.fetch.timeoutSeconds).toBe(30);
    expect(settings.fetch.maxBytes).toBe(2 * 1024 * 1024);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });
});

describe('normalizeWebToolsSettings', () => {
  it('undefined 输入回填完整默认值', () => {
    expect(normalizeWebToolsSettings(undefined)).toEqual(createDefaultWebToolsSettings());
  });

  it('保留已有值并补齐缺失分组', () => {
    const partial = {
      search: { enabled: false, provider: 'brave' as const },
      keys: { braveApiKey: 'bk' }
    } as WebToolsSettings;

    const settings = normalizeWebToolsSettings(partial);

    expect(settings.search).toEqual({ enabled: false, provider: 'brave' });
    expect(settings.keys.braveApiKey).toBe('bk');
    expect(settings.fetch.timeoutSeconds).toBe(30);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });

  it('ssrf.allowRanges 非数组时回退空表', () => {
    const settings = normalizeWebToolsSettings({
      ssrf: { allowRanges: 'bad' as unknown as string[] }
    } as WebToolsSettings);

    expect(settings.ssrf.allowRanges).toEqual([]);
  });
});
