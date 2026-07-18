import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { PiWebAccessSettings, UpdatePiWebAccessSettingsPayload } from '@chaptale/ipc-contract';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebAccessAdapter } from '../web-access-adapter';
import { SettingsService } from '../service';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-service-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('delegates web access config creation to the injected adapter', async () => {
    const adapter = createFakeWebAccessAdapter();
    const service = new SettingsService(adapter, { rootDir });

    await service.getState();

    expect(adapter.toConfig).toHaveBeenCalled();
  });

  it('creates web-search config when settings already exists', async () => {
    const service = createService();

    await writeFile(
      service.settingsPath,
      JSON.stringify(
        {
          version: 1,
          storage: { mode: 'global' }
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
    const service = createService();

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
          ssrf: { allowRanges: ['127.0.0.1/32'] }
        },
        null,
        2
      )
    );

    const state = await service.getState();

    expect(state.webAccess.webSearchEnabled).toBe(false);
    expect(state.webAccess.provider).toBe('tavily');
    expect(state.webAccess.tavilyApiKey).toBe('tvly-test');
    expect(state.webAccess.githubClone.enabled).toBe(false);
    expect(state.webAccess.githubClone.maxRepoSizeMB).toBe(20);
    expect(state.webAccess.youtube.enabled).toBe(false);
    expect(state.webAccess.video.maxSizeMB).toBe(12);
    expect(state.webAccess.ssrf?.allowRanges).toEqual(['127.0.0.1/32']);
  });

  it('falls back to global storage when workspace mode has no workspace path', async () => {
    const service = createService();

    const state = await service.update({ storage: { mode: 'workspace', workspacePath: undefined } });

    expect(state.settings.storage.mode).toBe('global');
    expect(state.paths.effectiveSessionDir).toBe(path.join(service.sessionsRootDir, 'global'));
  });

  it('resolves workspace cwd, storage context, and session directory from user settings', async () => {
    const service = createService();
    const workspacePath = path.join(rootDir, 'Story Workspace');

    const state = await service.update({ storage: { mode: 'workspace', workspacePath } });

    expect(await service.getCurrentCwd()).toBe(workspacePath);
    expect(await service.getStorageContext()).toEqual({ storageMode: 'workspace', workspacePath });
    expect(await service.getCurrentSessionDir()).toBe(state.paths.effectiveSessionDir);
    expect(state.paths.effectiveSessionDir).toContain('Story Workspace-');
  });

  it('persists and clears the last opened session without changing storage settings', async () => {
    const service = createService();
    const workspacePath = path.join(rootDir, 'Story Workspace');

    await service.update({ storage: { mode: 'workspace', workspacePath } });
    const persisted = await service.update({ lastSessionId: 'session-2' });

    expect(persisted.settings).toEqual({
      version: 1,
      storage: { mode: 'workspace', workspacePath },
      lastSessionId: 'session-2'
    });

    const cleared = await service.update({ lastSessionId: null });
    expect(cleared.settings).toEqual({ version: 1, storage: { mode: 'workspace', workspacePath } });
  });

  it('writes web-search config when web access settings are updated', async () => {
    const service = createService();

    await service.getState();
    await service.updateWebAccess({
      webSearchEnabled: false,
      provider: 'brave',
      braveApiKey: 'BSA_test',
      workflow: 'auto-summary',
      youtube: { enabled: false }
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

    const settings = JSON.parse(await readFile(service.settingsPath, 'utf8')) as Record<string, unknown>;
    expect(settings).toEqual({ version: 1, storage: { mode: 'global' } });
  });
});

function createService() {
  return new SettingsService(createFakeWebAccessAdapter(), { rootDir });
}

function createFakeWebAccessAdapter(): WebAccessAdapter {
  return {
    fromConfig: vi.fn((config: Record<string, unknown>) => {
      const webSearch = config.webSearch as { enabled?: boolean } | undefined;
      return {
        ...config,
        webSearchEnabled: webSearch?.enabled
      } as UpdatePiWebAccessSettingsPayload;
    }),
    mergeUpdate: vi.fn((current: PiWebAccessSettings, payload: UpdatePiWebAccessSettingsPayload) => ({
      ...current,
      ...payload,
      githubClone: { ...current.githubClone, ...payload.githubClone },
      youtube: { ...current.youtube, ...payload.youtube },
      video: { ...current.video, ...payload.video },
      ssrf: {
        allowRanges: payload.ssrf?.allowRanges ?? current.ssrf?.allowRanges ?? []
      }
    })),
    toConfig: vi.fn((settings: PiWebAccessSettings) => ({
      ...settings,
      webSearch: { enabled: settings.webSearchEnabled }
    }))
  };
}
