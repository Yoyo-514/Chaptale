import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

import { useLlmCustomModelForms } from '../../composables/useLlmCustomModelForms';
import { useLlmModelActions } from '../../composables/useLlmModelActions';
import { useLlmProviderAuth } from '../../composables/useLlmProviderAuth';
import { useLlmSettingsState } from '../../composables/useLlmSettingsState';

function createModels() {
  return {
    providers: [
      { provider: 'openai', providerName: 'OpenAI', authConfigured: true, modelCount: 1 },
      { provider: 'custom', providerName: 'Custom', authConfigured: false, modelCount: 1 }
    ],
    models: [
      {
        provider: 'openai',
        providerName: 'OpenAI',
        id: 'gpt-4.1',
        name: 'GPT 4.1',
        reasoning: false,
        input: ['text' as const],
        authConfigured: true,
        isDefault: true,
        isCustom: false
      },
      {
        provider: 'custom',
        providerName: 'Custom',
        id: 'custom-model',
        name: 'Custom Model',
        reasoning: false,
        input: ['text' as const],
        authConfigured: false,
        isDefault: false,
        isCustom: true
      }
    ],
    defaultModel: { provider: 'openai', modelId: 'gpt-4.1' }
  };
}

function createSettingsStore() {
  return {
    models: createModels(),
    fetchedCustomModels: [
      { id: 'custom-model', name: 'Already Added' },
      { id: 'new-model', name: 'New Model' }
    ],
    fetchCustomProviderModels: vi.fn().mockResolvedValue(true),
    addCustomModel: vi.fn().mockResolvedValue(true),
    addCustomProvider: vi.fn().mockResolvedValue(true),
    clearFetchedCustomModels: vi.fn(),
    setCustomProviderApiKey: vi.fn().mockResolvedValue(true),
    setProviderApiKey: vi.fn().mockResolvedValue(true),
    removeCustomProviderApiKey: vi.fn().mockResolvedValue(true),
    removeProviderApiKey: vi.fn().mockResolvedValue(true),
    removeCustomModel: vi.fn().mockResolvedValue(true),
    setDefaultModel: vi.fn().mockResolvedValue(true),
    updateCustomModelInput: vi.fn().mockResolvedValue(true)
  } as any;
}

describe('LLM settings composables', () => {
  it('derives visible provider/model state and switches model groups', async () => {
    const store = createSettingsStore();
    const state = useLlmSettingsState(store);

    expect(state.builtinCount.value).toBe(1);
    expect(state.customCount.value).toBe(1);
    expect(state.defaultModelLabel.value).toContain('GPT 4.1');
    expect(state.selectedProviderId.value).toBe('openai');

    state.setModelGroup('custom');
    await Promise.resolve();
    expect(state.visibleModels.value).toHaveLength(1);
    expect(state.providerViews.value[0]?.provider).toBe('custom');
    state.selectProvider(state.providerViews.value[0]!);
    expect(state.selectedProviderModels.value[0]?.id).toBe('custom-model');
  });

  it('submits provider API keys for builtin and custom groups and clears successful input', async () => {
    const store = createSettingsStore();
    const notification = { error: vi.fn(), success: vi.fn() } as any;
    const activeModelGroup = ref<'builtin' | 'custom'>('builtin');
    const auth = useLlmProviderAuth(store, notification, activeModelGroup);

    expect(auth.getApiKeyPlaceholder({ authConfigured: true } as any)).toBe('••••••••••••');
    auth.providerApiKeys.openai = ' sk-openai ';
    await auth.submitProviderApiKey('openai');
    expect(store.setProviderApiKey).toHaveBeenCalledWith('openai', 'sk-openai');
    expect(auth.providerApiKeys.openai).toBe('');

    activeModelGroup.value = 'custom';
    auth.providerApiKeys.custom = 'sk-custom';
    await auth.submitProviderApiKey('custom');
    expect(store.setCustomProviderApiKey).toHaveBeenCalledWith('custom', 'sk-custom');
    expect(auth.isApiKeySaving('custom')).toBe(false);

    await auth.removeProviderApiKey('custom');
    expect(store.removeCustomProviderApiKey).toHaveBeenCalledWith('custom');

    activeModelGroup.value = 'builtin';
    await auth.removeProviderApiKey('openai');
    expect(store.removeProviderApiKey).toHaveBeenCalledWith('openai');

    auth.providerApiKeys.empty = ' ';
    await auth.submitProviderApiKey('empty');
    expect(notification.error).toHaveBeenCalledWith('API Key 不能为空');
  });

  it('fetches custom model lists and submits custom provider/model drafts', async () => {
    const store = createSettingsStore();
    const notification = { success: vi.fn(), error: vi.fn() } as any;
    const activeModelGroup = ref<'builtin' | 'custom'>('builtin');
    const selectedProviderId = ref('');
    const selectedProviderModels = computed(() =>
      store.models.models.filter((model: any) => model.provider === 'custom')
    );
    const forms = useLlmCustomModelForms(
      store,
      notification,
      activeModelGroup,
      selectedProviderId,
      selectedProviderModels as any
    );

    forms.customProvider.provider = ' custom ';
    forms.customProvider.providerName = 'Custom';
    forms.customProvider.baseUrl = 'https://api.example.com';
    forms.customProvider.apiKey = 'sk';
    forms.providerModelDraft.modelId = 'model-a';
    forms.providerModelDraft.contextWindow = '4096';
    forms.providerModelDraft.supportsImageInput = true;

    expect(forms.fetchedModelOptions.value).toEqual([
      { id: 'custom-model', name: 'Already Added', isAdded: true },
      { id: 'new-model', name: 'New Model', isAdded: false }
    ]);
    await forms.fetchCustomModels();
    expect(store.fetchCustomProviderModels).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      api: 'openai-completions',
      apiKey: 'sk'
    });

    await forms.fetchCustomModelsForProvider('custom');
    expect(store.fetchCustomProviderModels).toHaveBeenCalledWith({ provider: 'custom' });
    expect(forms.pendingModelProvider.value).toBe('');

    forms.customModelDraft.modelId = 'model-b';
    forms.customModelDraft.modelName = 'Model B';
    await forms.submitCustomModelToProvider('custom');
    expect(store.addCustomModel).toHaveBeenCalledWith({
      provider: 'custom',
      modelId: 'model-b',
      modelName: 'Model B',
      input: ['text'],
      contextWindow: 128000
    });
    expect(notification.success).toHaveBeenCalledWith('模型已添加');

    forms.stageProviderModel();
    forms.providerModelDraft.modelId = 'model-c';
    forms.providerModelDraft.modelName = 'Model C';
    forms.stageProviderModel();

    await forms.submitCustomProvider();
    expect(store.addCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: ' custom ',
        providerName: 'Custom',
        models: [
          { modelId: 'model-a', modelName: undefined, input: ['text', 'image'], contextWindow: 4096 },
          { modelId: 'model-c', modelName: 'Model C', input: ['text'], contextWindow: 128000 }
        ]
      })
    );
    expect(activeModelGroup.value).toBe('custom');
    expect(selectedProviderId.value).toBe('custom');
    expect(store.clearFetchedCustomModels).toHaveBeenCalled();
    expect(forms.isCustomFormOpen.value).toBe(false);
  });

  it('wraps model mutation actions', async () => {
    const store = createSettingsStore();
    const actions = useLlmModelActions(store);
    const model = { provider: 'custom', id: 'model-a' } as any;

    await actions.setDefaultModel('openai', 'gpt-4.1');
    await actions.removeCustomModel('custom', 'model-a');
    await actions.toggleImageInput(model, true);
    await actions.toggleImageInput(model, false);

    expect(store.setDefaultModel).toHaveBeenCalledWith('openai', 'gpt-4.1');
    expect(store.removeCustomModel).toHaveBeenCalledWith('custom', 'model-a');
    expect(store.updateCustomModelInput).toHaveBeenNthCalledWith(1, 'custom', 'model-a', ['text', 'image']);
    expect(store.updateCustomModelInput).toHaveBeenNthCalledWith(2, 'custom', 'model-a', ['text']);
  });
});
