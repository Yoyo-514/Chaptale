<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useSessionStore } from '@/features/sessions';

import SettingsPathCard from '../components/SettingsPathCard.vue';
import SettingsSection from '../components/SettingsSection.vue';
import SettingsToggleField from '../components/SettingsToggleField.vue';
import { useSettingsStore } from '../store';

const settingsStore = useSettingsStore();
const sessionStore = useSessionStore();

const state = computed(() => settingsStore.state);
const storage = computed(() => state.value?.settings.storage);
const paths = computed(() => state.value?.paths);
const showInternalFiles = computed(() => state.value?.settings.explorer.showInternalFiles ?? false);

async function useGlobalStorage() {
  await settingsStore.useGlobalStorage();
  await sessionStore.loadStorageDebugInfo();
  await sessionStore.loadSessions();
}

async function setShowInternalFiles(value: boolean) {
  await settingsStore.update({ explorer: { showInternalFiles: value } });
}
</script>

<template>
  <SettingsSection
    title="工作区与会话存储"
    title-id="settings-storage-title"
    description="Global 适合单机默认使用；工作区模式会按项目路径隔离会话目录，方便不同项目独立保存历史记录。"
  >
    <template #badge>
      <span class="settings-pill">{{ storage?.mode === 'workspace' ? '工作区模式' : 'Global 模式' }}</span>
    </template>

    <SettingsPathCard
      label="当前会话目录"
      :value="paths?.effectiveSessionDir"
      emphasis
      class="settings-path-card-spacing"
    />

    <SettingsPathCard
      v-if="storage?.mode === 'workspace' && storage?.workspacePath"
      label="工作区路径"
      :value="storage.workspacePath"
      class="settings-path-card-spacing"
    />

    <div class="settings-actions">
      <AppButton type="button" :disabled="settingsStore.isLoading" @click="useGlobalStorage">使用 Global</AppButton>
    </div>
  </SettingsSection>

  <SettingsSection
    title="资源管理器"
    title-id="settings-explorer-title"
    description="控制侧栏文件树展示哪些内容；偏好跟着你而不跟着具体作品。"
  >
    <SettingsToggleField
      :model-value="showInternalFiles"
      title="显示内部文件"
      description="展示 .chaptale/ 等应用数据目录；日常写作不需要看到它们。"
      :disabled="settingsStore.isLoading"
      @update:model-value="setShowInternalFiles"
    />
  </SettingsSection>
</template>

<style scoped lang="scss">
@use '../styles/controls';

.settings-pill {
  @apply shrink-0 border px-2 py-1 text-xs;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.settings-path-card-spacing {
  @apply mt-2;
}

.settings-actions {
  @apply mt-3 flex flex-wrap justify-end gap-2;
}
</style>
