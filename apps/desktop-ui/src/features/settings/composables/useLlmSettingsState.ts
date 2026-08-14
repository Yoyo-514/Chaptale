import { computed, ref, watch } from 'vue';

import type { useSettingsStore } from '../store';
import {
  createProviderViews,
  getDefaultModelLabel,
  getProviderModels,
  getSelectedProvider,
  type ProviderView
} from '../utils/llm-settings.helpers';

type SettingsStore = ReturnType<typeof useSettingsStore>;

/**
 * 将后端模型快照投影为供应商列表和当前选择。
 * 刷新使供应商消失时自动回退到首项，避免界面保留悬空 ID。
 */
export function useLlmSettingsState(settingsStore: SettingsStore) {
  const selectedProviderId = ref('');

  const modelState = computed(() => settingsStore.models);
  const models = computed(() => modelState.value?.models ?? []);
  const providerViews = computed(() => createProviderViews(models.value, modelState.value?.providers ?? []));
  const selectedProvider = computed(() => getSelectedProvider(providerViews.value, selectedProviderId.value));
  const selectedProviderModels = computed(() => getProviderModels(models.value, selectedProvider.value));
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

  function selectProvider(provider: ProviderView) {
    selectedProviderId.value = provider.provider;
  }

  return {
    selectedProviderId,
    modelState,
    models,
    providerViews,
    selectedProvider,
    selectedProviderModels,
    defaultModelLabel,
    selectProvider
  };
}
