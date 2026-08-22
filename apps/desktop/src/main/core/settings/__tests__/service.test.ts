import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateWebToolsSettingsPayload, WebToolsSettings } from '@chaptale/ipc-contract';

import { WebToolsSettingsAdapter } from '../../../features/web-tools/adapter';
import { SettingsService } from '../service';
import type { WebToolsAdapter } from '../web-tools-adapter';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-service-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('delegates web tools config creation to the injected adapter', async () => {
    const adapter = createSpyAdapter();
    const service = new SettingsService(adapter, { rootDir });

    await service.getState();

    expect(adapter.toConfig).toHaveBeenCalled();
  });

  it('creates web-tools config when settings already exists', async () => {
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

    const config = JSON.parse(await readFile(service.webToolsConfigPath, 'utf8')) as {
      search?: { enabled?: boolean; provider?: string };
    };

    expect(config.search?.enabled).toBe(true);
    expect(config.search?.provider).toBe('duckduckgo');
  });

  it('reads existing web-tools config as the effective web tools state', async () => {
    const service = createService();

    await service.getState();
    await writeFile(
      service.webToolsConfigPath,
      JSON.stringify({
        search: { enabled: false, provider: 'tavily' },
        keys: { tavilyApiKey: 'tvly-test' },
        fetch: { timeoutSeconds: 15, maxBytes: 1048576 },
        ssrf: { allowRanges: ['10.1.0.0/16'] }
      })
    );

    const state = await service.getState();

    expect(state.webTools.search.enabled).toBe(false);
    expect(state.webTools.search.provider).toBe('tavily');
    // 真实 key 不下发渲染进程，只回掩码占位（空串/undefined 表示未配置）。
    expect(state.webTools.keys.tavilyApiKey).toBe('••••••••');
    expect(state.webTools.fetch.timeoutSeconds).toBe(15);
    expect(state.webTools.fetch.maxBytes).toBe(1048576);
    expect(state.webTools.ssrf.allowRanges).toEqual(['10.1.0.0/16']);
  });

  it('keeps real key when renderer submits the mask placeholder', async () => {
    const service = createService();

    await service.getState();
    await service.updateWebTools({ keys: { braveApiKey: 'BSA_keep' } });

    // 渲染进程拿到掩码，原样提交：应保留已存 key，不清除。
    await service.updateWebTools({ keys: { braveApiKey: '••••••••' } });
    const config = JSON.parse(await readFile(service.webToolsConfigPath, 'utf8')) as {
      keys?: { braveApiKey?: string };
    };
    expect(config.keys?.braveApiKey).toBe('BSA_keep');
  });

  it('clears key when renderer submits empty string', async () => {
    const service = createService();

    await service.getState();
    await service.updateWebTools({ keys: { braveApiKey: 'BSA_clear' } });
    await service.updateWebTools({ keys: { braveApiKey: '' } });

    const config = JSON.parse(await readFile(service.webToolsConfigPath, 'utf8')) as {
      keys?: { braveApiKey?: string };
    };
    // 空串即清除信号；读取端 normalize 为空串 → 未配置。
    expect(config.keys?.braveApiKey).toBe('');
  });

  it('falls back to global storage when workspace mode has no workspace path', async () => {
    const service = createService();

    const state = await service.update({ storage: { mode: 'workspace', workspacePath: undefined } });

    expect(state.settings.storage.mode).toBe('global');
    expect(state.paths.currentCwd).toBe(path.join(service.agentDir, 'global'));
    expect(state.paths.effectiveSessionDir).toBe(path.join(service.sessionsRootDir, 'global'));
  });

  it('resolves workspace cwd, storage context, and session directory from user settings', async () => {
    const service = createService();
    const workspacePath = path.join(rootDir, 'Story Workspace');

    const state = await service.update({ storage: { mode: 'workspace', workspacePath } });

    expect(await service.getCurrentCwd()).toBe(workspacePath);
    expect(await service.getStorageContext()).toEqual({ storageMode: 'workspace', workspacePath });
    expect(await service.getCurrentSessionDir()).toBe(state.paths.effectiveSessionDir);
    expect(state.paths.currentCwd).toBe(workspacePath);
    expect(state.paths.effectiveSessionDir).toContain('Story Workspace-');
  });

  it('persists and clears the last opened session per storage domain', async () => {
    const service = createService();
    const workspacePath = path.join(rootDir, 'Story Workspace');
    const domainKey = `workspace:${workspacePath}`;

    await service.update({ storage: { mode: 'workspace', workspacePath } });
    const persisted = await service.update({ lastSessionId: 'session-2' });

    // 合成视图按当前域返回；落盘只写域槽位。
    expect(persisted.settings.lastSessionId).toBe('session-2');
    expect(persisted.settings.lastSessions).toEqual({ [domainKey]: 'session-2' });

    const cleared = await service.update({ lastSessionId: null });
    expect(cleared.settings.lastSessionId).toBeUndefined();
    expect(cleared.settings.lastSessions).toBeUndefined();
  });

  it('clears workspacePath when switching back to global mode', async () => {
    const service = createService();
    const workspacePath = path.join(rootDir, 'Story Workspace');

    await service.update({ storage: { mode: 'workspace', workspacePath } });
    const state = await service.update({ storage: { mode: 'global' } });

    expect(state.settings.storage).toEqual({ mode: 'global' });

    const raw = JSON.parse(await readFile(service.settingsPath, 'utf8')) as { storage?: { workspacePath?: string } };
    expect(raw.storage?.workspacePath).toBeUndefined();
  });

  it('isolates last session slots across storage domains', async () => {
    const service = createService();
    const workspaceA = path.join(rootDir, 'Story A');
    const workspaceB = path.join(rootDir, 'Story B');

    // global 域记一个槽。
    await service.update({ lastSessionId: 'global-session' });

    // 切到 A 记槽，再切到 B：B 无槽。
    await service.update({ storage: { mode: 'workspace', workspacePath: workspaceA } });
    await service.update({ lastSessionId: 'session-a' });
    await service.update({ storage: { mode: 'workspace', workspacePath: workspaceB } });
    expect((await service.getState()).settings.lastSessionId).toBeUndefined();

    // 切回 A 恢复 A 槽；切回 global 恢复 global 槽。
    await service.update({ storage: { mode: 'workspace', workspacePath: workspaceA } });
    expect((await service.getState()).settings.lastSessionId).toBe('session-a');

    await service.update({ storage: { mode: 'global' } });
    expect((await service.getState()).settings.lastSessionId).toBe('global-session');
  });

  it('writes web-tools config when web tools settings are updated', async () => {
    const service = createService();

    await service.getState();
    await service.updateWebTools({
      search: { enabled: false, provider: 'brave' },
      keys: { braveApiKey: 'BSA_test' }
    });

    const config = JSON.parse(await readFile(service.webToolsConfigPath, 'utf8')) as {
      search?: { enabled?: boolean; provider?: string };
      keys?: { braveApiKey?: string };
    };

    expect(config.search?.enabled).toBe(false);
    expect(config.search?.provider).toBe('brave');
    expect(config.keys?.braveApiKey).toBe('BSA_test');

    const settings = JSON.parse(await readFile(service.settingsPath, 'utf8')) as Record<string, unknown>;
    expect(settings).toEqual({ version: 1, storage: { mode: 'global' }, theme: 'dark' });
  });

  it('production adapter normalizes and merges web-tools config', async () => {
    const service = new SettingsService(new WebToolsSettingsAdapter(), { rootDir });

    const state = await service.updateWebTools({ search: { provider: 'exa' }, keys: { exaApiKey: 'ek' } });

    expect(state.webTools.search.provider).toBe('exa');
    // 真实 key 落盘到配置文件，但下发渲染进程的状态只含掩码。
    expect(state.webTools.keys.exaApiKey).toBe('••••••••');
    expect(state.webTools.search.enabled).toBe(true);

    const config = JSON.parse(await readFile(service.webToolsConfigPath, 'utf8')) as {
      keys?: { exaApiKey?: string };
    };
    expect(config.keys?.exaApiKey).toBe('ek');
  });
});

function createService() {
  return new SettingsService(createSpyAdapter(), { rootDir });
}

function createSpyAdapter(): WebToolsAdapter {
  return {
    fromConfig: vi.fn((config: Record<string, unknown>) => {
      const search = config.search as { enabled?: boolean; provider?: string } | undefined;
      return {
        ...config,
        search: {
          enabled: search?.enabled ?? true,
          provider: search?.provider ?? 'duckduckgo'
        }
      } as UpdateWebToolsSettingsPayload;
    }),
    mergeUpdate: vi.fn((current: WebToolsSettings, payload: UpdateWebToolsSettingsPayload) => ({
      search: { ...current.search, ...payload.search },
      keys: { ...current.keys, ...payload.keys },
      fetch: { ...current.fetch, ...payload.fetch },
      ssrf: { allowRanges: payload.ssrf?.allowRanges ?? current.ssrf.allowRanges }
    })),
    toConfig: vi.fn((settings: WebToolsSettings) => ({ ...settings }))
  };
}
