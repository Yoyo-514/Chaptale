import { describe, expect, it } from 'vitest';

import {
  cloneDefaultSettings,
  DEFAULT_WEB_ACCESS_SETTINGS,
  mergeSettings,
  mergeWebAccessSettings
} from '../settings-defaults';

describe('settings defaults', () => {
  it('returns isolated default settings clones for mutation-safe callers', () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();

    first.storage.mode = 'workspace';
    first.storage.workspacePath = 'E:/Stories';

    expect(second.storage).toEqual({ mode: 'global' });
  });

  it('merges app settings without carrying web access fields', () => {
    const settings = mergeSettings({
      storage: { mode: 'workspace', workspacePath: 'E:/Stories' }
    });

    expect(settings).toEqual({
      version: 1,
      storage: { mode: 'workspace', workspacePath: 'E:/Stories' }
    });
  });

  it('merges web access settings while preserving nested defaults', () => {
    const settings = mergeWebAccessSettings({ provider: 'brave', githubClone: { enabled: false } });

    expect(settings.provider).toBe('brave');
    expect(settings.githubClone.enabled).toBe(false);
    expect(settings.githubClone.maxRepoSizeMB).toBe(DEFAULT_WEB_ACCESS_SETTINGS.githubClone.maxRepoSizeMB);
    expect(settings.youtube.enabled).toBe(true);
  });

  it('keeps explicit falsey web access values instead of replacing them with defaults', () => {
    const settings = mergeWebAccessSettings({
      webSearchEnabled: false,
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 0,
      video: { maxSizeMB: 0 },
      ssrf: { allowRanges: [] }
    });

    expect(settings.webSearchEnabled).toBe(false);
    expect(settings.allowBrowserCookies).toBe(false);
    expect(settings.curatorTimeoutSeconds).toBe(0);
    expect(settings.video.maxSizeMB).toBe(0);
    expect(settings.ssrf?.allowRanges).toEqual([]);
  });
});
