import { describe, expect, it } from 'vitest';

import { cloneDefaultSettings, DEFAULT_SETTINGS, mergeSettings, mergeWebAccessSettings } from '../settings-defaults';

describe('settings defaults', () => {
  it('returns isolated default settings clones for mutation-safe callers', () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();

    first.webAccess.githubClone.enabled = false;
    first.webAccess.ssrf?.allowRanges.push('127.0.0.1/32');

    expect(second.webAccess.githubClone.enabled).toBe(DEFAULT_SETTINGS.webAccess.githubClone.enabled);
    expect(second.webAccess.ssrf?.allowRanges).toEqual([]);
  });

  it('merges top-level settings while preserving nested defaults', () => {
    const settings = mergeSettings({
      storage: { mode: 'workspace', workspacePath: 'E:/Stories' },
      webAccess: mergeWebAccessSettings({ provider: 'brave', githubClone: { enabled: false } })
    });

    expect(settings.version).toBe(1);
    expect(settings.storage).toEqual({ mode: 'workspace', workspacePath: 'E:/Stories' });
    expect(settings.webAccess.provider).toBe('brave');
    expect(settings.webAccess.githubClone.enabled).toBe(false);
    expect(settings.webAccess.githubClone.maxRepoSizeMB).toBe(DEFAULT_SETTINGS.webAccess.githubClone.maxRepoSizeMB);
    expect(settings.webAccess.youtube.enabled).toBe(true);
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
