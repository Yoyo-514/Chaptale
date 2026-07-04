import type { ChaptaleCustomProviderApi, ChaptaleModelInfo } from '@chaptale/ipc-contract';
import { computed, reactive, ref, type Ref } from 'vue';

import type { useNotificationStore } from '../../../stores/notification';
import type { useSettingsStore } from '../../../stores/settings';
import {
  createCustomModelDraft,
  draftToInput,
  parseContextWindow,
  resetCustomModelDraft
} from '../utils/custom-model-draft';
import { getAddableFetchedModels, type ModelGroup } from '../utils/llm-settings.helpers';

type NotificationStore = ReturnType<typeof useNotificationStore>;
type SettingsStore = ReturnType<typeof useSettingsStore>;

export function useLlmCustomModelForms(
  settingsStore: SettingsStore,
  notificationStore: NotificationStore,
  activeModelGroup: Ref<ModelGroup>,
  selectedProviderId: Ref<string>,
  selectedProviderModels: Readonly<Ref<ChaptaleModelInfo[]>>
) {
  const isCustomFormOpen = ref(false);
  const pendingModelProvider = ref('');
  const customProvider = reactive({
    provider: '',
    providerName: '',
    baseUrl: '',
    api: 'openai-completions' as ChaptaleCustomProviderApi,
    apiKey: ''
  });
  // 新建供应商时的首个模型草稿（Context Window / 图像输入按模型配置）
  const providerModelDraft = reactive(createCustomModelDraft());
  // 已有自定义供应商“添加模型”的草稿
  const customModelDraft = reactive(createCustomModelDraft());

  const fetchedCustomModels = computed(() => settingsStore.fetchedCustomModels);
  const addableFetchedModels = computed(() =>
    getAddableFetchedModels(fetchedCustomModels.value, selectedProviderModels.value)
  );

  async function fetchCustomModels() {
    await settingsStore.fetchCustomProviderModels({
      baseUrl: customProvider.baseUrl,
      api: customProvider.api,
      apiKey: customProvider.apiKey || undefined
    });
  }

  async function fetchCustomModelsForProvider(provider: string) {
    pendingModelProvider.value = provider;

    try {
      await settingsStore.fetchCustomProviderModels({ provider });
    } finally {
      pendingModelProvider.value = '';
    }
  }

  async function submitCustomModelToProvider(provider: string) {
    const succeeded = await settingsStore.addCustomModel({
      provider,
      modelId: customModelDraft.modelId,
      modelName: customModelDraft.modelName || undefined,
      input: draftToInput(customModelDraft),
      contextWindow: parseContextWindow(customModelDraft)
    });

    if (succeeded) {
      notificationStore.success('模型已添加');
      resetCustomModelDraft(customModelDraft);
    }
  }

  async function submitCustomProvider() {
    const succeeded = await settingsStore.addCustomProvider({
      provider: customProvider.provider,
      providerName: customProvider.providerName,
      baseUrl: customProvider.baseUrl,
      api: customProvider.api,
      modelId: providerModelDraft.modelId,
      modelName: providerModelDraft.modelName || undefined,
      apiKey: customProvider.apiKey || undefined,
      input: draftToInput(providerModelDraft),
      contextWindow: parseContextWindow(providerModelDraft)
    });

    if (succeeded) {
      notificationStore.success('供应商已添加');
      activeModelGroup.value = 'custom';
      selectedProviderId.value = customProvider.provider.trim();
      customProvider.provider = '';
      customProvider.providerName = '';
      customProvider.baseUrl = '';
      customProvider.api = 'openai-completions';
      customProvider.apiKey = '';
      resetCustomModelDraft(providerModelDraft);
      settingsStore.clearFetchedCustomModels();
      isCustomFormOpen.value = false;
    }
  }

  return {
    isCustomFormOpen,
    pendingModelProvider,
    customProvider,
    providerModelDraft,
    customModelDraft,
    fetchedCustomModels,
    addableFetchedModels,
    fetchCustomModels,
    fetchCustomModelsForProvider,
    submitCustomModelToProvider,
    submitCustomProvider
  };
}
