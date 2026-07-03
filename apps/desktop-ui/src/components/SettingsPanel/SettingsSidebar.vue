<script setup lang="ts">
import { useSettingsStore, type SettingsSection } from '../../stores/settings';

const settingsStore = useSettingsStore();

const sections: { id: SettingsSection; title: string; description: string; icon: string }[] = [
  {
    id: 'workspace',
    title: '工作区',
    description: '会话位置与存储模式',
    icon: 'i-mingcute-folder-2-line'
  },
  {
    id: 'llm',
    title: '模型',
    description: '供应商、凭据与默认模型',
    icon: 'i-mingcute-ai-line'
  },
  {
    id: 'files',
    title: '配置文件',
    description: '应用与模型配置路径',
    icon: 'i-mingcute-file-info-line'
  }
];
</script>

<template>
  <nav class="settings-panel-nav" aria-label="设置分类">
    <button
      v-for="section in sections"
      :key="section.id"
      class="settings-nav-item"
      :class="{ 'is-active': settingsStore.activeSection === section.id }"
      type="button"
      @click="settingsStore.setSection(section.id)"
    >
      <span class="settings-nav-icon" :class="section.icon" aria-hidden="true" />
      <span class="settings-nav-copy">
        <span class="settings-nav-title">{{ section.title }}</span>
        <span class="settings-nav-description">{{ section.description }}</span>
      </span>
    </button>
  </nav>
</template>

<style scoped lang="scss">
.settings-panel-nav {
  @apply flex flex-col gap-2 border-r p-3;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
}

.settings-nav-item {
  @apply flex min-w-0 items-start gap-2 border px-2.5 py-2 text-left outline-none transition-colors duration-150;

  background: transparent;
  border-color: transparent;
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.settings-nav-item:hover,
.settings-nav-item.is-active {
  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
}

.settings-nav-item.is-active {
  color: var(--primary-solid);
}

.settings-nav-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-nav-icon {
  @apply mt-0.5 shrink-0 text-base;
}

.settings-nav-copy {
  @apply flex min-w-0 flex-col gap-1;
}

.settings-nav-title {
  @apply text-xs font-semibold;
}

.settings-nav-description {
  @apply text-xs leading-4;

  color: var(--muted-foreground);
}
</style>
