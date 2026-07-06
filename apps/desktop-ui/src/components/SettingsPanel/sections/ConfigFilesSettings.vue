<script setup lang="ts">
import { computed } from 'vue';

import { useSettingsStore } from '../../../stores/settings';

const settingsStore = useSettingsStore();
const paths = computed(() => settingsStore.state?.paths);
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-files-title">
    <div class="settings-section-heading">
      <h3 id="settings-files-title" class="settings-section-title">配置文件</h3>
      <button class="settings-secondary-button" type="button" @click="settingsStore.openConfigDir()">
        打开配置目录
      </button>
    </div>
    <p class="settings-section-description">
      这里用于排查本机配置路径。通常无需手动编辑，除非需要备份、迁移或排查模型配置问题。
    </p>

    <div class="settings-path-grid">
      <div class="settings-path-card">
        <span class="settings-path-label">应用设置文件</span>
        <code class="settings-path-value">{{ paths?.settingsPath || '读取中...' }}</code>
      </div>
      <div class="settings-path-card">
        <span class="settings-path-label">agent 设置文件</span>
        <code class="settings-path-value">{{ paths?.piSettingsPath || '读取中...' }}</code>
      </div>
      <div class="settings-path-card">
        <span class="settings-path-label">第三方模型配置文件</span>
        <code class="settings-path-value">{{ paths?.piModelsPath || '读取中...' }}</code>
      </div>
      <div class="settings-path-card">
        <span class="settings-path-label">内置模型凭据配置文件</span>
        <code class="settings-path-value">{{ paths?.piAuthPath || '读取中...' }}</code>
      </div>
      <div class="settings-path-card">
        <span class="settings-path-label">联网能力配置文件</span>
        <code class="settings-path-value">{{ paths?.piWebAccessConfigPath || '读取中...' }}</code>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-section {
  @apply p-2;

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

.settings-path-grid {
  @apply grid gap-2;
}

.settings-path-card {
  @apply flex min-w-0 flex-col gap-1 border px-3 py-2;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
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

.settings-secondary-button {
  @apply border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.settings-secondary-button:hover {
  background: var(--secondary);
}

.settings-secondary-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
