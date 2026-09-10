import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { registerWorkspaceTransitionGuard } from '@/utils/workspace-transition';

import { useSettingsStore } from '../store';

function createSettingsState(
  webSearchEnabled = true,
  currentCwd = 'E:/Stories/Story-1',
  workspacePath = 'E:/Stories/Story-1',
  lastSessionId?: string
) {
  return {
    settings: {
      version: 1,
      workspace: { path: workspacePath },
      ...(lastSessionId ? { lastSessionId } : {})
    },
    webAccess: {
      webSearchEnabled,
      provider: 'auto',
      workflow: 'none',
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
      modelsPath: 'agent/models.json',
      webToolsConfigPath: 'agent/web-tools.json',
      sessionsRootDir: 'agent/sessions',
      effectiveSessionDir: 'agent/sessions/Story-1',
      currentCwd
    }
  };
}

function createSession(id: string, overrides = {}) {
  return {
    id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: 'E:/Stories/Story-1',
    path: `${id}.jsonl`,
    leafId: null,
    messageCount: 1,
    totalTokens: 0,
    totalCost: 0,
    ...overrides
  };
}

function createModelsResult(defaultModel?: { provider: string; modelId: string }) {
  return {
    providers: [{ provider: 'openai', providerName: 'OpenAI', authConfigured: true, modelCount: 1 }],
    models: [
      {
        provider: 'openai',
        providerName: 'OpenAI',
        id: 'gpt-4.1',
        name: 'GPT 4.1',
        reasoning: false,
        input: ['text' as const],
        authConfigured: true,
        isDefault: Boolean(defaultModel)
      }
    ],
    defaultModel
  };
}

function installDesktopApi() {
  const settingsState = createSettingsState(true);
  const modelsResult = createModelsResult({ provider: 'openai', modelId: 'gpt-4.1' });
  const api = {
    settings: {
      getState: vi.fn().mockResolvedValue(settingsState),
      update: vi.fn().mockResolvedValue(settingsState),
      updateWebTools: vi.fn().mockResolvedValue(settingsState),
      selectWorkspaceDir: vi.fn().mockResolvedValue({
        canceled: false,
        state: createSettingsState(false, 'E:/workspace-b', 'E:/workspace-b')
      }),
      openConfigDir: vi.fn().mockResolvedValue(undefined)
    },
    session: {
      list: vi
        .fn()
        .mockResolvedValue([
          createSession('session-a', { cwd: 'E:/workspace-a' }),
          createSession('session-b', { cwd: 'E:/workspace-b' })
        ]),
      create: vi.fn().mockResolvedValue(createSession('created'))
    },
    models: {
      list: vi.fn().mockResolvedValue(modelsResult),
      setDefault: vi.fn().mockResolvedValue(modelsResult),
      setProviderApiKey: vi.fn().mockResolvedValue(modelsResult),
      fetchCustomProviderModels: vi.fn().mockResolvedValue({ models: [{ id: 'model-a', name: 'Model A' }] }),
      addCustomProvider: vi.fn().mockResolvedValue(modelsResult),
      addCustomModel: vi.fn().mockResolvedValue(modelsResult),
      setCustomProviderApiKey: vi.fn().mockResolvedValue(modelsResult),
      removeCustomProviderApiKey: vi.fn().mockResolvedValue(modelsResult),
      removeCustomProvider: vi.fn().mockResolvedValue(modelsResult),
      updateCustomModelInput: vi.fn().mockResolvedValue(modelsResult),
      removeCustomModel: vi.fn().mockResolvedValue(modelsResult),
      removeProviderAuth: vi.fn().mockResolvedValue(modelsResult)
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

describe('settings store', () => {
  it('loads settings and model lists through the shared action runner', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    await store.load();
    await store.loadModels();

    expect(store.state).toEqual(createSettingsState(true));
    expect(store.models).toEqual(createModelsResult({ provider: 'openai', modelId: 'gpt-4.1' }));
    expect(store.isLoading).toBe(false);
    expect(store.isModelsLoading).toBe(false);
    expect(api.settings.getState).toHaveBeenCalled();
    expect(api.models.list).toHaveBeenCalled();
  });

  it('binds sessions to state current cwd during initial settings load', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const api = installDesktopApi();
    // B 作品槽位为空：绑定 B 后应回退 B 作品候选第一个，而不是沿用 A 作品槽位里的会话。
    const state = createSettingsState(true, workspaceB, workspaceB, '');
    api.settings.getState.mockResolvedValue(state);
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: workspaceA }),
      createSession('session-b', { cwd: workspaceB })
    ]);
    const store = useSettingsStore();
    const sessionStore = useSessionStore();

    await store.load();

    expect(store.state).toEqual(state);
    expect(sessionStore.activeCwd).toBe(workspaceB);
    expect(sessionStore.currentSessionId).toBe('session-b');
    expect(sessionStore.currentSession?.cwd).toBe(workspaceB);
  });

  it('opens and switches the settings panel while lazily loading LLM models', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    store.openPanel('files');
    expect(store.isOpen).toBe(true);
    expect(store.activeSection).toBe('files');
    await vi.waitFor(() => expect(api.settings.getState).toHaveBeenCalled());

    store.models = undefined;
    store.setSection('llm');
    expect(store.activeSection).toBe('llm');
    await vi.waitFor(() => expect(api.models.list).toHaveBeenCalled());

    store.closePanel();
    expect(store.isOpen).toBe(false);
  });

  it('updates web tools and opens the config directory', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();
    const sessionStore = useSessionStore();
    const bindCwd = vi.spyOn(sessionStore, 'bindCwd').mockResolvedValue(undefined);
    const updatedState = createSettingsState(false, 'E:/Stories/Story-2', 'E:/Stories/Story-2');
    api.settings.updateWebTools.mockResolvedValue(updatedState);

    await expect(store.updateWebTools({ search: { enabled: false } })).resolves.toBe(true);
    expect(store.state).toStrictEqual(updatedState);

    await store.openConfigDir();

    expect(api.settings.updateWebTools).toHaveBeenCalledWith({ search: { enabled: false } });
    expect(api.settings.selectWorkspaceDir).not.toHaveBeenCalled();
    // 联网设置与作品无关：不该顺带把会话重绑一次。
    expect(bindCwd).not.toHaveBeenCalled();
    expect(api.settings.openConfigDir).toHaveBeenCalled();
  });

  it('switching the workspace still asks for confirmation first', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();
    const confirm = vi.fn().mockResolvedValue(false);
    const unregister = registerWorkspaceTransitionGuard(confirm);

    try {
      await expect(store.update({ workspace: { path: 'E:/workspace-b' } })).resolves.toBe(false);
    } finally {
      unregister();
    }

    expect(confirm).toHaveBeenCalledOnce();
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it('surfaces web access save failures through the shared action runner', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();
    const notifications = useNotificationStore();
    const beforeState = createSettingsState(true);
    store.state = beforeState as any;
    api.settings.updateWebTools.mockRejectedValue(new Error('save failed'));

    await expect(store.updateWebTools({ search: { enabled: false } })).resolves.toBe(false);

    expect(store.state).toStrictEqual(beforeState);
    expect(store.error).toBe('save failed');
    expect(notifications.items.at(-1)).toMatchObject({
      kind: 'error',
      title: '更新联网设置失败',
      description: 'save failed'
    });
  });

  it('runs every model mutation through runModelsAction and refreshes the list', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    await expect(store.setDefaultModel('openai', 'gpt-4.1')).resolves.toBe(true);
    await expect(
      store.addCustomProvider({
        provider: 'custom',
        providerName: 'Custom',
        baseUrl: 'https://api.example.com',
        api: 'openai-responses',
        models: [{ modelId: 'm', input: ['text'] }]
      })
    ).resolves.toBe(true);
    await expect(store.addCustomModel({ provider: 'custom', modelId: 'm2', input: ['text'] })).resolves.toBe(true);
    await expect(store.setCustomProviderApiKey('custom', 'sk-custom')).resolves.toBe(true);
    await expect(store.removeCustomProviderApiKey('custom')).resolves.toBe(true);
    await expect(store.updateCustomModelInput('custom', 'm2', ['text', 'image'])).resolves.toBe(true);
    await expect(store.removeCustomModel('custom', 'm2')).resolves.toBe(true);
    await expect(store.removeCustomProvider('custom')).resolves.toBe(true);

    expect(api.models.setDefault).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-4.1' });
    expect(api.models.addCustomProvider).toHaveBeenCalled();
    expect(api.models.addCustomModel).toHaveBeenCalledWith({ provider: 'custom', modelId: 'm2', input: ['text'] });
    expect(api.models.removeCustomProvider).toHaveBeenCalledWith({ provider: 'custom' });
    expect(store.models).toEqual(createModelsResult({ provider: 'openai', modelId: 'gpt-4.1' }));
    expect(store.isModelsLoading).toBe(false);
  });

  it('fetches and clears custom provider model drafts', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    await expect(
      store.fetchCustomProviderModels({ baseUrl: 'https://api.example.com', api: 'openai-responses' })
    ).resolves.toBe(true);
    expect(api.models.fetchCustomProviderModels).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      api: 'openai-responses'
    });
    expect(store.fetchedCustomModels).toEqual([{ id: 'model-a', name: 'Model A' }]);
    expect(store.isFetchingCustomModels).toBe(false);

    store.clearFetchedCustomModels();
    expect(store.fetchedCustomModels).toEqual([]);
  });

  it('captures action failures and notifies the user', async () => {
    const api = installDesktopApi();
    api.models.list.mockRejectedValueOnce(new Error("Error invoking remote method 'models:list': Error: 403 blocked"));
    const store = useSettingsStore();
    const notifications = useNotificationStore();

    await store.loadModels();

    expect(store.error).toBe('403 blocked');
    expect(notifications.items.at(-1)).toMatchObject({
      kind: 'error',
      title: '读取模型清单失败',
      description: '403 blocked'
    });
    expect(store.isModelsLoading).toBe(false);
  });
});
