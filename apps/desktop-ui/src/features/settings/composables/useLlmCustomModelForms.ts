import { computed, reactive, ref, watch, type Ref } from 'vue';

import type { ChaptaleCustomProviderApi, ChaptaleModelInfo } from '@chaptale/ipc-contract';

import type { useNotificationStore } from '@/features/notifications';

import type { useSettingsStore } from '../store';
import {
  createCustomModelDraft,
  draftToInput,
  parseContextWindow,
  resetCustomModelDraft,
  type CustomModelDraft
} from '../utils/custom-model-draft';
import { getFetchedModelOptions, type ModelGroup } from '../utils/llm-settings.helpers';

type NotificationStore = ReturnType<typeof useNotificationStore>;
type SettingsStore = ReturnType<typeof useSettingsStore>;

type StagedCustomModel = {
  modelId: string;
  modelName?: string;
  input: ReturnType<typeof draftToInput>;
  contextWindow: number | undefined;
};

function toStagedModel(draft: CustomModelDraft): StagedCustomModel {
  return {
    modelId: draft.modelId.trim(),
    modelName: draft.modelName.trim() || undefined,
    input: draftToInput(draft),
    contextWindow: parseContextWindow(draft)
  };
}

/**
 * 管理“新建供应商”和“已有供应商添加/编辑模型”两套表单草稿。
 * 表单只暂存与校验界面输入，成功提交后由 settings store 返回的完整模型快照刷新事实状态。
 */
export function useLlmCustomModelForms(
  settingsStore: SettingsStore,
  notificationStore: NotificationStore,
  activeModelGroup: Ref<ModelGroup>,
  selectedProviderId: Ref<string>,
  selectedProviderModels: Readonly<Ref<ChaptaleModelInfo[]>>
) {
  const isCustomFormOpen = ref(false);
  const isCustomModelDialogOpen = ref(false);
  const editingModelId = ref('');
  const pendingModelProvider = ref('');
  const customProvider = reactive({
    provider: '',
    providerName: '',
    baseUrl: '',
    api: 'openai-completions' as ChaptaleCustomProviderApi,
    apiKey: ''
  });
  // 新建供应商弹窗内的“待添加模型”草稿与列表。
  const providerModelDraft = reactive(createCustomModelDraft());
  const stagedProviderModels = ref<StagedCustomModel[]>([]);
  // 已有自定义供应商“添加/编辑模型”的草稿。
  const customModelDraft = reactive(createCustomModelDraft());

  const fetchedCustomModels = computed(() => settingsStore.fetchedCustomModels);
  const fetchedModelOptions = computed(() =>
    getFetchedModelOptions(fetchedCustomModels.value, selectedProviderModels.value)
  );
  const customModelDialogTitle = computed(() => (editingModelId.value ? '编辑自定义模型' : '添加自定义模型'));
  const customModelSubmitLabel = computed(() => (editingModelId.value ? '保存模型' : '添加模型'));

  watch(selectedProviderId, () => {
    settingsStore.clearFetchedCustomModels();
  });

  watch(isCustomFormOpen, open => {
    if (open) {
      settingsStore.clearFetchedCustomModels();
    }
  });

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

  function stageProviderModel() {
    const staged = toStagedModel(providerModelDraft);

    if (!staged.modelId) {
      notificationStore.error('模型 ID 不能为空');
      return;
    }

    const existingIndex = stagedProviderModels.value.findIndex(model => model.modelId === staged.modelId);
    // 同一供应商内 modelId 唯一；重复暂存视为更新草稿，而不是生成后端必然覆盖的重复项。
    if (existingIndex >= 0) {
      stagedProviderModels.value[existingIndex] = staged;
    } else {
      stagedProviderModels.value.push(staged);
    }

    resetCustomModelDraft(providerModelDraft);
  }

  function removeStagedProviderModel(modelId: string) {
    stagedProviderModels.value = stagedProviderModels.value.filter(model => model.modelId !== modelId);
  }

  function openAddCustomModelDialog() {
    editingModelId.value = '';
    settingsStore.clearFetchedCustomModels();
    resetCustomModelDraft(customModelDraft);
    isCustomModelDialogOpen.value = true;
  }

  function openEditCustomModelDialog(model: ChaptaleModelInfo) {
    editingModelId.value = model.id;
    customModelDraft.modelId = model.id;
    customModelDraft.modelName = model.name;
    customModelDraft.contextWindow = String(model.contextWindow);
    customModelDraft.supportsImageInput = model.input.includes('image');
    settingsStore.clearFetchedCustomModels();
    isCustomModelDialogOpen.value = true;
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
      notificationStore.success(editingModelId.value ? '模型已保存' : '模型已添加');
      resetCustomModelDraft(customModelDraft);

      if (editingModelId.value) {
        editingModelId.value = '';
        isCustomModelDialogOpen.value = false;
      }
    }
  }

  async function submitCustomProvider() {
    // 提交前复制 staged input，避免关闭弹窗后的草稿重置影响正在进行的异步请求。
    const providerId = customProvider.provider.trim();
    const models = stagedProviderModels.value.map(model => ({
      modelId: model.modelId,
      modelName: model.modelName,
      input: [...model.input],
      contextWindow: model.contextWindow
    }));
    const succeeded = await settingsStore.addCustomProvider({
      provider: customProvider.provider,
      providerName: customProvider.providerName,
      baseUrl: customProvider.baseUrl,
      api: customProvider.api,
      apiKey: customProvider.apiKey || undefined,
      models
    });

    if (succeeded) {
      notificationStore.success('供应商已添加');
      activeModelGroup.value = 'custom';
      selectedProviderId.value = providerId;
      customProvider.provider = '';
      customProvider.providerName = '';
      customProvider.baseUrl = '';
      customProvider.api = 'openai-completions';
      customProvider.apiKey = '';
      resetCustomModelDraft(providerModelDraft);
      stagedProviderModels.value = [];
      settingsStore.clearFetchedCustomModels();
      isCustomFormOpen.value = false;
    }
  }

  return {
    isCustomFormOpen,
    isCustomModelDialogOpen,
    customModelDialogTitle,
    customModelSubmitLabel,
    editingModelId,
    pendingModelProvider,
    customProvider,
    providerModelDraft,
    stagedProviderModels,
    customModelDraft,
    fetchedCustomModels,
    fetchedModelOptions,
    fetchCustomModels,
    fetchCustomModelsForProvider,
    stageProviderModel,
    removeStagedProviderModel,
    openAddCustomModelDialog,
    openEditCustomModelDialog,
    submitCustomModelToProvider,
    submitCustomProvider
  };
}
