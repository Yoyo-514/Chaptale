import { describe, expect, it } from 'vitest';

import { mergeWebAccessSettings } from '../../../../core/settings/defaults';
import { fromPiWebAccessConfig, mergeWebAccessUpdate, PiWebAccessAdapter, toPiWebAccessConfig } from '../config-mapper';

describe('pi web access config mapper', () => {
  it('exposes the existing mapper behavior through the web access adapter', () => {
    const adapter = new PiWebAccessAdapter();
    const current = mergeWebAccessSettings({ githubClone: { maxRepoSizeMB: 100 } });

    expect(adapter.fromConfig({ webSearch: { enabled: false } })).toMatchObject({ webSearchEnabled: false });
    expect(adapter.mergeUpdate(current, { githubClone: { enabled: false } })).toMatchObject({
      githubClone: { enabled: false, maxRepoSizeMB: 100 }
    });
    expect(adapter.toConfig(current)).toMatchObject({ webSearch: { enabled: true } });
  });

  it('reads only valid pi web access config values', () => {
    expect(
      fromPiWebAccessConfig({
        provider: 'tavily',
        workflow: 'auto-summary',
        webSearch: { enabled: false },
        allowBrowserCookies: false,
        curatorTimeoutSeconds: 0,
        githubClone: { enabled: false, maxRepoSizeMB: 20, cloneTimeoutSeconds: 10, clonePath: 42 },
        youtube: { enabled: false, preferredModel: 'gemini' },
        video: { enabled: true, preferredModel: 'gemini-video', maxSizeMB: 0 },
        ssrf: { allowRanges: ['127.0.0.1/32', 123, '::1/128'] }
      })
    ).toMatchObject({
      provider: 'tavily',
      workflow: 'auto-summary',
      webSearchEnabled: false,
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 0,
      githubClone: { enabled: false, maxRepoSizeMB: 20, cloneTimeoutSeconds: 10, clonePath: undefined },
      youtube: { enabled: false, preferredModel: 'gemini' },
      video: { enabled: true, preferredModel: 'gemini-video', maxSizeMB: 0 },
      ssrf: { allowRanges: ['127.0.0.1/32', '::1/128'] }
    });
  });

  it('serializes pi web access config without blank optional strings', () => {
    const config = toPiWebAccessConfig(
      mergeWebAccessSettings({
        provider: 'brave',
        braveApiKey: '  BSA_test  ',
        geminiApiKey: '   ',
        githubClone: { clonePath: '   ' },
        ssrf: { allowRanges: [] }
      })
    );

    expect(config).toMatchObject({
      provider: 'brave',
      braveApiKey: 'BSA_test',
      webSearch: { enabled: true },
      ssrf: { allowRanges: [] }
    });
    expect(config).not.toHaveProperty('geminiApiKey');
    expect((config.githubClone as Record<string, unknown>).clonePath).toBeUndefined();
  });

  it('deep-merges partial web access updates', () => {
    const current = mergeWebAccessSettings({
      provider: 'gemini',
      githubClone: { enabled: true, maxRepoSizeMB: 100, cloneTimeoutSeconds: 20 },
      youtube: { enabled: true, preferredModel: 'old-youtube' }
    });

    expect(
      mergeWebAccessUpdate(current, {
        githubClone: { enabled: false },
        youtube: { preferredModel: 'new-youtube' }
      })
    ).toMatchObject({
      provider: 'gemini',
      githubClone: { enabled: false, maxRepoSizeMB: 100, cloneTimeoutSeconds: 20 },
      youtube: { enabled: true, preferredModel: 'new-youtube' }
    });
  });
});
