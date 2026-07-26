import { computed, reactive, watch } from 'vue';

import { useSettingsStore } from '../store';

/**
 * 在设置快照之外维护 Prompt 编辑草稿，支持放弃、恢复默认值与显式保存。
 * store 刷新后草稿跟随最新磁盘状态，未提交内容不会提前写入持久化层。
 */
export function usePromptSettingsDraft() {
  const settingsStore = useSettingsStore();
  const draft = reactive({
    systemPrompt: '',
    appendSystemPrompt: ''
  });

  function discardChanges() {
    const state = settingsStore.promptSettings;
    if (!state) {
      return;
    }

    draft.systemPrompt = state.systemPrompt;
    draft.appendSystemPrompt = state.appendSystemPrompt;
  }

  watch(() => settingsStore.promptSettings, discardChanges, { immediate: true });

  const isSystemPromptBlank = computed(() => !draft.systemPrompt.trim());
  const hasChanges = computed(() => {
    const state = settingsStore.promptSettings;
    return Boolean(
      state && (draft.systemPrompt !== state.systemPrompt || draft.appendSystemPrompt !== state.appendSystemPrompt)
    );
  });
  const canSave = computed(
    () => Boolean(settingsStore.promptSettings) && hasChanges.value && !isSystemPromptBlank.value
  );

  function restoreDefaultSystemPrompt() {
    const state = settingsStore.promptSettings;
    if (state) {
      draft.systemPrompt = state.defaultSystemPrompt;
    }
  }

  function clearAppendSystemPrompt() {
    draft.appendSystemPrompt = '';
  }

  async function save() {
    if (!canSave.value) {
      return false;
    }

    return settingsStore.updatePromptSettings({
      systemPrompt: draft.systemPrompt,
      appendSystemPrompt: draft.appendSystemPrompt
    });
  }

  return {
    draft,
    isSystemPromptBlank,
    hasChanges,
    canSave,
    discardChanges,
    restoreDefaultSystemPrompt,
    clearAppendSystemPrompt,
    save
  };
}
