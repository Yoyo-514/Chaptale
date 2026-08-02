import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';

import { useWorkspaceStore } from '../store';

function createSettingsState(workspacePath = 'E:/workspace-b') {
  return {
    settings: {
      version: 1,
      storage: { mode: 'workspace' as const, workspacePath }
    },
    webAccess: {
      webSearchEnabled: true,
      provider: 'auto' as const,
      workflow: 'none' as const,
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 20,
      githubClone: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      youtube: { enabled: true, preferredModel: 'gemini-3-flash-preview' },
      video: { enabled: true, preferredModel: 'gemini-3-flash-preview', maxSizeMB: 50 },
      ssrf: { allowRanges: [] }
    },
    paths: {
      rootDir: 'root',
      agentDir: 'agent',
      settingsPath: 'settings.json',
      piSettingsPath: 'agent/settings.json',
      piModelsPath: 'agent/models.json',
      piAuthPath: 'agent/auth.json',
      piWebAccessConfigPath: 'agent/web-search.json',
      sessionsRootDir: 'agent/sessions',
      effectiveSessionDir: `${workspacePath}/.chaptale/sessions`,
      currentCwd: workspacePath
    }
  };
}

function createSession(id: string, cwd: string) {
  return {
    id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd,
    path: `${id}.jsonl`,
    leafId: null,
    messageCount: 1,
    scope: 'workspace' as const,
    totalTokens: 0,
    totalCost: 0
  };
}

function installDesktopApi(state = createSettingsState()) {
  const api = {
    settings: {
      selectWorkspaceDir: vi.fn().mockResolvedValue({ canceled: false, state }),
      getState: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockResolvedValue(state)
    },
    session: {
      list: vi.fn().mockResolvedValue([createSession('session-b', state.paths.currentCwd)]),
      getStorageDebugInfo: vi.fn().mockResolvedValue({
        rootDir: 'root',
        sessionDir: 'sessions',
        cwd: state.paths.currentCwd,
        storageMode: 'workspace'
      })
    }
  };
  window.chaptaleDesktop = api as any;
  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  delete window.chaptaleDesktop;
});

describe('workspace store', () => {
  it('opens a workspace and synchronizes settings and session projections', async () => {
    const state = createSettingsState();
    const api = installDesktopApi(state);
    const workspaceStore = useWorkspaceStore();
    const settingsStore = useSettingsStore();
    const sessionStore = useSessionStore();

    await expect(workspaceStore.openWorkspace()).resolves.toBe(true);

    expect(api.settings.selectWorkspaceDir).toHaveBeenCalledOnce();
    expect(settingsStore.state).toStrictEqual(state);
    expect(sessionStore.activeCwd).toBe(state.paths.currentCwd);
    expect(sessionStore.currentSessionId).toBe('session-b');
    expect(api.session.getStorageDebugInfo).toHaveBeenCalledOnce();
    expect(workspaceStore.isOpening).toBe(false);
    expect(workspaceStore.error).toBe('');
  });

  it('treats directory picker cancellation as a no-op', async () => {
    const api = installDesktopApi();
    api.settings.selectWorkspaceDir.mockResolvedValue({ canceled: true });
    const workspaceStore = useWorkspaceStore();
    const settingsStore = useSettingsStore();

    await expect(workspaceStore.openWorkspace()).resolves.toBe(false);

    expect(settingsStore.state).toBeUndefined();
    expect(api.session.list).not.toHaveBeenCalled();
    expect(workspaceStore.error).toBe('');
  });

  it('keeps the new workspace boundary when session rebinding fails', async () => {
    const previousWorkspace = 'E:/workspace-a';
    const state = createSettingsState();
    const api = installDesktopApi(state);
    api.session.list.mockRejectedValue(new Error('list failed'));
    const workspaceStore = useWorkspaceStore();
    const settingsStore = useSettingsStore();
    const sessionStore = useSessionStore();
    const notifications = useNotificationStore();
    sessionStore.sessions = [createSession('session-a', previousWorkspace)];
    sessionStore.activeCwd = previousWorkspace;
    sessionStore.currentSessionId = 'session-a';

    await expect(workspaceStore.openWorkspace()).resolves.toBe(false);

    expect(settingsStore.state).toStrictEqual(state);
    expect(sessionStore.activeCwd).toBe(state.paths.currentCwd);
    expect(sessionStore.currentSessionId).toBe('');
    expect(workspaceStore.error).toBe('list failed');
    expect(notifications.items.at(-1)).toMatchObject({
      kind: 'error',
      title: '打开工作区失败',
      description: 'list failed'
    });
  });
});
