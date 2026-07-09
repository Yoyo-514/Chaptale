import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';

import type { useSettingsStore } from '@/stores/settings';

type SettingsStore = ReturnType<typeof useSettingsStore>;

export function useLlmModelActions(settingsStore: SettingsStore) {
  async function removeCustomModel(provider: string, modelId: string) {
    await settingsStore.removeCustomModel(provider, modelId);
  }

  async function setDefaultModel(provider: string, modelId: string) {
    await settingsStore.setDefaultModel(provider, modelId);
  }

  async function toggleImageInput(model: ChaptaleModelInfo, checked: boolean) {
    const input = checked ? ['text' as const, 'image' as const] : ['text' as const];
    await settingsStore.updateCustomModelInput(model.provider, model.id, input);
  }

  return {
    removeCustomModel,
    setDefaultModel,
    toggleImageInput
  };
}
