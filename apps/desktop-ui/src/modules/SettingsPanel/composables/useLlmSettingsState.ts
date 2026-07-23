import { computed, ref, watch } from 'vue';

import type { useSettingsStore } from '@/stores/settings';

import {
  countModelsByGroup,
  createProviderViews,
  filterModelsByGroup,
  getDefaultModelLabel,
  getProviderModels,
  getSelectedProvider,
  type ModelGroup,
  type ProviderView
} from '../utils/llm-settings.helpers';

type SettingsStore = ReturnType<typeof useSettingsStore>;

/**
 * 将后端模型快照投影为内置/自定义分组、供应商列表和当前选择。
 * 当刷新或切组使供应商消失时自动回退到首项，避免界面保留悬空 ID。
 */
export function useLlmSettingsState(settingsStore: SettingsStore) {
  const selectedProviderId = ref('');
  const activeModelGroup = ref<ModelGroup>('builtin');

  const modelState = computed(() => settingsStore.models);
  const models = computed(() => modelState.value?.models ?? []);
  const visibleModels = computed(() => filterModelsByGroup(models.value, activeModelGroup.value));
  const providerViews = computed(() => createProviderViews(visibleModels.value, modelState.value?.providers ?? []));
  const selectedProvider = computed(() => getSelectedProvider(providerViews.value, selectedProviderId.value));
  const selectedProviderModels = computed(() => getProviderModels(visibleModels.value, selectedProvider.value));
  const modelGroupCounts = computed(() => countModelsByGroup(models.value));
  const builtinCount = computed(() => modelGroupCounts.value.builtin);
  const customCount = computed(() => modelGroupCounts.value.custom);
  const defaultModelLabel = computed(() => getDefaultModelLabel(modelState.value));

  watch(
    providerViews,
    nextProviders => {
      if (!nextProviders.length) {
        selectedProviderId.value = '';
        return;
      }

      if (!nextProviders.some(provider => provider.provider === selectedProviderId.value)) {
        selectedProviderId.value = nextProviders[0].provider;
      }
    },
    { immediate: true }
  );

  function setModelGroup(group: ModelGroup) {
    activeModelGroup.value = group;
  }

  function selectProvider(provider: ProviderView) {
    selectedProviderId.value = provider.provider;
  }

  return {
    selectedProviderId,
    activeModelGroup,
    modelState,
    models,
    visibleModels,
    providerViews,
    selectedProvider,
    selectedProviderModels,
    builtinCount,
    customCount,
    defaultModelLabel,
    setModelGroup,
    selectProvider
  };
}
