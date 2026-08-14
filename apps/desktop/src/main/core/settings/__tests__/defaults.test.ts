import { describe, expect, it } from 'vitest';

import type { UpdateWebToolsSettingsPayload } from '@chaptale/ipc-contract';

import {
  cloneDefaultSettings,
  cloneDefaultWebToolsSettings,
  DEFAULT_WEB_TOOLS_SETTINGS,
  mergeSettings,
  mergeWebToolsSettings
} from '../defaults';

describe('settings defaults', () => {
  it('returns isolated default settings clones for mutation-safe callers', () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();

    first.storage.mode = 'workspace';
    first.storage.workspacePath = 'E:/Stories';

    expect(second.storage).toEqual({ mode: 'global' });
  });

  it('merges app settings without carrying web tools fields', () => {
    const settings = mergeSettings({
      storage: { mode: 'workspace', workspacePath: 'E:/Stories' }
    });

    expect(settings).toEqual({
      version: 1,
      storage: { mode: 'workspace', workspacePath: 'E:/Stories' }
    });
  });

  it('returns isolated web tools default clones', () => {
    const first = cloneDefaultWebToolsSettings();
    const second = cloneDefaultWebToolsSettings();

    first.search.enabled = false;
    first.fetch.timeoutSeconds = 5;

    expect(second.search.enabled).toBe(true);
    expect(second.fetch.timeoutSeconds).toBe(DEFAULT_WEB_TOOLS_SETTINGS.fetch.timeoutSeconds);
  });
});

describe('mergeWebToolsSettings', () => {
  it('merges nested groups while preserving unsubmitted values', () => {
    const current = cloneDefaultWebToolsSettings();
    const payload: UpdateWebToolsSettingsPayload = {
      search: { enabled: false, provider: 'brave' },
      keys: { braveApiKey: 'bk' }
    };

    const settings = mergeWebToolsSettings(current, payload);

    expect(settings.search).toEqual({ enabled: false, provider: 'brave' });
    expect(settings.keys.braveApiKey).toBe('bk');
    // 未提交分组保持现值。
    expect(settings.fetch.timeoutSeconds).toBe(current.fetch.timeoutSeconds);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });

  it('keeps explicit falsey values instead of replacing them with defaults', () => {
    const current = cloneDefaultWebToolsSettings();
    const settings = mergeWebToolsSettings(current, {
      search: { enabled: false },
      fetch: { timeoutSeconds: 0, maxBytes: 0 },
      ssrf: { allowRanges: [] }
    });

    expect(settings.search.enabled).toBe(false);
    expect(settings.search.provider).toBe('duckduckgo');
    expect(settings.fetch.timeoutSeconds).toBe(0);
    expect(settings.fetch.maxBytes).toBe(0);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });
});
