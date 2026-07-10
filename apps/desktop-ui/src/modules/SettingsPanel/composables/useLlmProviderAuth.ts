import { reactive, ref, type Ref } from 'vue';

import type { useNotificationStore } from '@/stores/notification';
import type { useSettingsStore } from '@/stores/settings';
import type { ModelGroup, ProviderView } from '../utils/llm-settings.helpers';

type NotificationStore = ReturnType<typeof useNotificationStore>;
type SettingsStore = ReturnType<typeof useSettingsStore>;

export function useLlmProviderAuth(
  settingsStore: SettingsStore,
  notificationStore: NotificationStore,
  activeModelGroup: Ref<ModelGroup>
) {
  const pendingApiKeyProvider = ref('');
  const providerApiKeys = reactive<Record<string, string>>({});

  function getApiKeyPlaceholder(provider?: ProviderView) {
    if (provider?.authConfigured) {
      return '••••••••••••';
    }

    return '输入 API Key';
  }

  function isApiKeySaving(provider?: string) {
    return pendingApiKeyProvider.value === provider;
  }

  async function submitProviderApiKey(provider: string) {
    const apiKey = providerApiKeys[provider]?.trim();

    if (!apiKey) {
      notificationStore.error('API Key 不能为空');
      return;
    }

    pendingApiKeyProvider.value = provider;

    try {
      const succeeded =
        activeModelGroup.value === 'custom'
          ? await settingsStore.setCustomProviderApiKey(provider, apiKey)
          : await settingsStore.setProviderApiKey(provider, apiKey);

      if (succeeded) {
        providerApiKeys[provider] = '';
      }
    } finally {
      pendingApiKeyProvider.value = '';
    }
  }

  async function removeProviderApiKey(provider: string) {
    pendingApiKeyProvider.value = provider;

    try {
      if (activeModelGroup.value === 'custom') {
        await settingsStore.removeCustomProviderApiKey(provider);
        return;
      }

      await settingsStore.removeProviderApiKey(provider);
    } finally {
      pendingApiKeyProvider.value = '';
    }
  }

  return {
    providerApiKeys,
    pendingApiKeyProvider,
    getApiKeyPlaceholder,
    isApiKeySaving,
    submitProviderApiKey,
    removeProviderApiKey
  };
}
