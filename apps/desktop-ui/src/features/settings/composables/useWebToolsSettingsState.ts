import { klona } from 'klona';
import { computed, reactive, watch } from 'vue';

import type { WebToolsProvider, WebToolsSettings } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/features/notifications';

import { useSettingsStore } from '../store';
import {
  createDefaultWebToolsSettings,
  normalizeWebToolsSettings,
  webToolsProviders
} from '../utils/web-tools-settings';

/** WebToolsSettings 区块的草稿状态、派生可见性与保存动作。 */
export function useWebToolsSettingsState() {
  const settingsStore = useSettingsStore();
  const notificationStore = useNotificationStore();

  const providers = webToolsProviders;

  const draft = reactive<WebToolsSettings>(createDefaultWebToolsSettings());

  const activeProvider = computed(() => providers.find(provider => provider.value === draft.search.provider));

  const isLoading = computed(() => settingsStore.isLoading);

  watch(
    () => settingsStore.state?.webTools,
    snapshot => {
      if (snapshot) {
        Object.assign(draft, klona(normalizeWebToolsSettings(snapshot)));
      }
    },
    { immediate: true }
  );

  function selectProvider(provider: string) {
    draft.search.provider = provider as WebToolsProvider;
  }

  async function save() {
    const success = await settingsStore.updateWebTools({
      search: { ...draft.search },
      keys: { ...draft.keys },
      fetch: { ...draft.fetch },
      ssrf: { allowRanges: [...draft.ssrf.allowRanges] }
    });

    if (success) {
      notificationStore.success('联网设置已保存');
    }
  }

  function resetToDefaults() {
    Object.assign(draft, createDefaultWebToolsSettings());
  }

  return {
    providers,
    draft,
    isLoading,
    activeProvider,
    selectProvider,
    save,
    resetToDefaults
  };
}
