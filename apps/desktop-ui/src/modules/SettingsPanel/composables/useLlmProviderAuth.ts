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
  const pendingKeyProvider = ref('');
  const providerApiKeys = reactive<Record<string, string>>({});

  function getKeyPlaceholder(provider?: ProviderView) {
    if (provider?.authConfigured) {
      return '••••••••••••';
    }

    return activeModelGroup.value === 'custom' ? '输入模型 Key' : '输入 API Key';
  }

  function isKeySaving(provider?: string) {
    return pendingKeyProvider.value === provider;
  }

  async function submitProviderApiKey(provider: string) {
    const apiKey = providerApiKeys[provider]?.trim();

    if (!apiKey) {
      notificationStore.error('API Key 不能为空');
      return;
    }

    pendingKeyProvider.value = provider;

    try {
      const succeeded =
        activeModelGroup.value === 'custom'
          ? await settingsStore.setCustomProviderApiKey(provider, apiKey)
          : await settingsStore.setProviderApiKey(provider, apiKey);

      if (succeeded) {
        providerApiKeys[provider] = '';
      }
    } finally {
      pendingKeyProvider.value = '';
    }
  }

  async function removeProviderAuth(provider: string) {
    pendingKeyProvider.value = provider;

    try {
      if (activeModelGroup.value === 'custom') {
        await settingsStore.removeCustomProviderApiKey(provider);
        return;
      }

      await settingsStore.removeProviderAuth(provider);
    } finally {
      pendingKeyProvider.value = '';
    }
  }

  return {
    providerApiKeys,
    pendingKeyProvider,
    getKeyPlaceholder,
    isKeySaving,
    submitProviderApiKey,
    removeProviderAuth
  };
}
