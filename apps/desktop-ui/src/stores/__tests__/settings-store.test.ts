import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '../notification';
import { useSettingsStore } from '../settings';

function createSettingsState(webSearchEnabled = true) {
  return {
    settings: {
      version: 1,
      storage: { mode: 'global' }
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
      piSettingsPath: 'agent/settings.json',
      piModelsPath: 'agent/models.json',
      piAuthPath: 'agent/auth.json',
      piWebAccessConfigPath: 'agent/web-search.json',
      sessionsRootDir: 'agent/sessions',
      effectiveSessionDir: 'agent/sessions/global'
    }
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
      updateWebAccess: vi.fn().mockResolvedValue(settingsState),
      selectWorkspaceDir: vi.fn().mockResolvedValue({ canceled: false, state: createSettingsState(false) }),
      openConfigDir: vi.fn().mockResolvedValue(undefined)
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

  it('updates workspace settings, selects a workspace, and opens the config directory', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    await store.updateWebAccess({ webSearchEnabled: false });
    await store.selectWorkspaceDir();
    await store.useGlobalStorage();
    await store.openConfigDir();

    expect(api.settings.updateWebAccess).toHaveBeenCalledWith({ webSearchEnabled: false });
    expect(api.settings.selectWorkspaceDir).toHaveBeenCalled();
    expect(api.settings.update).toHaveBeenCalledWith({ storage: { mode: 'global' } });
    expect(api.settings.openConfigDir).toHaveBeenCalled();
    expect(store.state).toBeDefined();
  });

  it('runs every model mutation through runModelsAction and refreshes the list', async () => {
    const api = installDesktopApi();
    const store = useSettingsStore();

    await expect(store.setDefaultModel('openai', 'gpt-4.1')).resolves.toBe(true);
    await expect(store.setProviderApiKey('openai', 'sk-test')).resolves.toBe(true);
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
    await expect(store.removeProviderAuth('openai')).resolves.toBe(true);

    expect(api.models.setDefault).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-4.1' });
    expect(api.models.setProviderApiKey).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
    expect(api.models.addCustomProvider).toHaveBeenCalled();
    expect(api.models.addCustomModel).toHaveBeenCalledWith({ provider: 'custom', modelId: 'm2', input: ['text'] });
    expect(api.models.removeProviderAuth).toHaveBeenCalledWith({ provider: 'openai' });
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
