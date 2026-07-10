<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import SettingsPathCard from '../components/SettingsPathCard.vue';
import SettingsSection from '../components/SettingsSection.vue';

const settingsStore = useSettingsStore();
const sessionStore = useSessionStore();

const state = computed(() => settingsStore.state);
const storage = computed(() => state.value?.settings.storage);
const paths = computed(() => state.value?.paths);

async function useGlobalStorage() {
  await settingsStore.useGlobalStorage();
  await sessionStore.loadStorageDebugInfo();
  await sessionStore.loadSessions();
}

async function selectWorkspaceDir() {
  await settingsStore.selectWorkspaceDir();
  await sessionStore.loadStorageDebugInfo();
  await sessionStore.loadSessions();
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
      v-if="storage?.workspacePath"
      label="工作区路径"
      :value="storage.workspacePath"
      class="settings-path-card-spacing"
    />

    <div class="settings-actions">
      <AppButton type="button" :disabled="settingsStore.isLoading" @click="useGlobalStorage">使用 Global</AppButton>
      <AppButton variant="primary" type="button" :disabled="settingsStore.isLoading" @click="selectWorkspaceDir">
        选择工作区
      </AppButton>
    </div>
  </SettingsSection>
</template>

<style scoped lang="scss">
@use '../styles/controls';

.settings-pill {
  @apply shrink-0 border px-2 py-1 text-xs;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-path-card-spacing {
  @apply mt-2;
}

.settings-actions {
  @apply mt-3 flex flex-wrap justify-end gap-2;
}
</style>
