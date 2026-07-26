import { describe, expect, it } from 'vitest';

import {
  createDefaultWebAccessSettings,
  normalizeWebAccessSettings,
  webAccessProviders,
  webAccessWorkflows
} from '../../utils/web-access-settings';

describe('web access settings helpers', () => {
  it('defines stable provider and workflow metadata', () => {
    expect(webAccessProviders.map(provider => provider.value)).toEqual([
      'auto',
      'openai',
      'exa',
      'brave',
      'parallel',
      'tavily',
      'perplexity',
      'gemini'
    ]);
    expect(webAccessWorkflows.map(workflow => workflow.value)).toEqual(['none', 'auto-summary', 'summary-review']);
  });

  it('creates isolated default settings instances', () => {
    const first = createDefaultWebAccessSettings();
    const second = createDefaultWebAccessSettings();

    first.githubClone.enabled = false;
    first.ssrf?.allowRanges.push('127.0.0.1/32');

    expect(second.githubClone.enabled).toBe(true);
    expect(second.ssrf?.allowRanges).toEqual([]);
  });

  it('normalizes nested settings while preserving explicit falsey values', () => {
    expect(
      normalizeWebAccessSettings({
        ...createDefaultWebAccessSettings(),
        webSearchEnabled: false,
        curatorTimeoutSeconds: 0,
        githubClone: { enabled: false, maxRepoSizeMB: 0, cloneTimeoutSeconds: 0 },
        ssrf: { allowRanges: 'invalid' as unknown as string[] }
      })
    ).toMatchObject({
      webSearchEnabled: false,
      curatorTimeoutSeconds: 0,
      githubClone: { enabled: false, maxRepoSizeMB: 0, cloneTimeoutSeconds: 0 },
      ssrf: { allowRanges: [] }
    });
  });
});
