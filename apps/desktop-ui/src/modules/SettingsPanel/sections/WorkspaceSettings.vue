<script setup lang="ts">
import { computed } from 'vue';

import { useSessionStore } from '../../../stores/session';
import { useSettingsStore } from '../../../stores/settings';

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
  <section class="settings-section" aria-labelledby="settings-storage-title">
    <div class="settings-section-heading">
      <h3 id="settings-storage-title" class="settings-section-title">工作区与会话存储</h3>
      <span class="settings-pill">{{ storage?.mode === 'workspace' ? '工作区模式' : 'Global 模式' }}</span>
    </div>
    <p class="settings-section-description">
      Global 适合单机默认使用；工作区模式会按项目路径隔离会话目录，方便不同项目独立保存历史记录。
    </p>

    <div class="settings-path-card is-emphasis">
      <span class="settings-path-label">当前会话目录</span>
      <code class="settings-path-value">{{ paths?.effectiveSessionDir || '读取中...' }}</code>
    </div>

    <div v-if="storage?.workspacePath" class="settings-path-card">
      <span class="settings-path-label">工作区路径</span>
      <code class="settings-path-value">{{ storage.workspacePath }}</code>
    </div>

    <div class="settings-actions">
      <button
        class="settings-secondary-button"
        type="button"
        :disabled="settingsStore.isLoading"
        @click="useGlobalStorage"
      >
        使用 Global
      </button>
      <button
        class="settings-primary-button"
        type="button"
        :disabled="settingsStore.isLoading"
        @click="selectWorkspaceDir"
      >
        选择工作区
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '../styles/controls';

.settings-section {
  @apply h-full min-h-0 overflow-y-auto p-2;

  background: var(--surface-acrylic-subtle);
}

.settings-section-heading {
  @apply flex items-center justify-between gap-3;
}

.settings-section-title {
  @apply m-0 text-sm font-semibold;
}

.settings-section-description {
  @apply mt-1 mb-3 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-pill,
.settings-path-card {
  @apply border;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-pill {
  @apply shrink-0 px-2 py-1 text-xs;
}

.settings-path-card {
  @apply mt-2 flex min-w-0 flex-col gap-1 px-3 py-2;
}

.settings-path-card.is-emphasis {
  border-color: var(--primary);
}

.settings-path-label {
  @apply text-xs;

  color: var(--muted-foreground);
}

.settings-path-value {
  @apply break-all text-xs;

  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.settings-actions {
  @apply mt-3 flex flex-wrap justify-end gap-2;
}
</style>
