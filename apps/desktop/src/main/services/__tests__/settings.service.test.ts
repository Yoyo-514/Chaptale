import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsService } from '../settings.service';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-service-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('creates web-search config when settings already exists', async () => {
    const service = new SettingsService({ rootDir });

    await writeFile(
      service.settingsPath,
      JSON.stringify(
        {
          version: 1,
          storage: { mode: 'global' },
          llm: {}
        },
        null,
        2
      )
    );

    await service.getState();

    const config = JSON.parse(await readFile(service.piWebAccessConfigPath, 'utf8')) as {
      webSearch?: { enabled?: boolean };
      workflow?: string;
    };

    expect(config.webSearch?.enabled).toBe(true);
    expect(config.workflow).toBe('none');
  });

  it('reads existing web-search config as the effective web access state', async () => {
    const service = new SettingsService({ rootDir });

    await service.getState();
    await writeFile(
      service.piWebAccessConfigPath,
      JSON.stringify(
        {
          provider: 'tavily',
          webSearch: { enabled: false },
          workflow: 'auto-summary',
          tavilyApiKey: 'tvly-test',
          githubClone: { enabled: false, maxRepoSizeMB: 20 },
          youtube: { enabled: false },
          video: { enabled: true, maxSizeMB: 12 },
          ssrf: { allowRanges: ['127.0.0.1/32', 123] }
        },
        null,
        2
      )
    );

    const state = await service.getState();

    expect(state.settings.webAccess.webSearchEnabled).toBe(false);
    expect(state.settings.webAccess.provider).toBe('tavily');
    expect(state.settings.webAccess.tavilyApiKey).toBe('tvly-test');
    expect(state.settings.webAccess.githubClone.enabled).toBe(false);
    expect(state.settings.webAccess.githubClone.maxRepoSizeMB).toBe(20);
    expect(state.settings.webAccess.youtube.enabled).toBe(false);
    expect(state.settings.webAccess.video.maxSizeMB).toBe(12);
    expect(state.settings.webAccess.ssrf?.allowRanges).toEqual(['127.0.0.1/32']);
  });

  it('falls back to global storage when workspace mode has no workspace path', async () => {
    const service = new SettingsService({ rootDir });

    const state = await service.update({ storage: { mode: 'workspace', workspacePath: undefined } });

    expect(state.settings.storage.mode).toBe('global');
    expect(state.paths.effectiveSessionDir).toBe(path.join(service.sessionsRootDir, 'global'));
  });

  it('resolves workspace cwd, storage context, and session directory from user settings', async () => {
    const service = new SettingsService({ rootDir });
    const workspacePath = path.join(rootDir, 'Story Workspace');

    const state = await service.update({ storage: { mode: 'workspace', workspacePath } });

    expect(await service.getCurrentCwd()).toBe(workspacePath);
    expect(await service.getStorageContext()).toEqual({ storageMode: 'workspace', workspacePath });
    expect(await service.getCurrentSessionDir()).toBe(state.paths.effectiveSessionDir);
    expect(state.paths.effectiveSessionDir).toContain('Story Workspace-');
  });

  it('writes web-search config when web access settings are updated', async () => {
    const service = new SettingsService({ rootDir });

    await service.getState();
    await service.update({
      webAccess: {
        webSearchEnabled: false,
        provider: 'brave',
        braveApiKey: 'BSA_test',
        workflow: 'auto-summary',
        youtube: { enabled: false }
      }
    });

    const config = JSON.parse(await readFile(service.piWebAccessConfigPath, 'utf8')) as {
      braveApiKey?: string;
      provider?: string;
      webSearch?: { enabled?: boolean };
      workflow?: string;
      youtube?: { enabled?: boolean };
    };

    expect(config.webSearch?.enabled).toBe(false);
    expect(config.provider).toBe('brave');
    expect(config.braveApiKey).toBe('BSA_test');
    expect(config.workflow).toBe('auto-summary');
    expect(config.youtube?.enabled).toBe(false);
  });
});
