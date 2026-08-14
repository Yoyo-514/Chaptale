import { reactive, ref } from 'vue';

import type { useNotificationStore } from '@/features/notifications';

import type { useSettingsStore } from '../store';
import type { ProviderView } from '../utils/llm-settings.helpers';

type NotificationStore = ReturnType<typeof useNotificationStore>;
type SettingsStore = ReturnType<typeof useSettingsStore>;

function getApiKeyPlaceholder(provider?: ProviderView) {
  return provider?.authConfigured ? '••••••••••••' : '输入 API Key';
}

export function useLlmProviderAuth(settingsStore: SettingsStore, notificationStore: NotificationStore) {
  const pendingApiKeyProvider = ref('');
  const providerApiKeys = reactive<Record<string, string>>({});

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
      const succeeded = await settingsStore.setCustomProviderApiKey(provider, apiKey);

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
      await settingsStore.removeCustomProviderApiKey(provider);
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
