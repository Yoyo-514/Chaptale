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
.settings-section {
  @apply p-2;

  background: var(--surface-acrylic-subtle);
}

.settings-section-heading {
  @apply flex items-start justify-between gap-3;
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

.settings-primary-button,
.settings-secondary-button {
  @apply border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  border-radius: calc(var(--radius) * 0.5);
}

.settings-primary-button {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.settings-primary-button:hover:not(:disabled) {
  background: var(--primary-solid-hover);
}

.settings-secondary-button {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.settings-secondary-button:hover:not(:disabled) {
  background: var(--secondary);
}

.settings-primary-button:focus-visible,
.settings-secondary-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
