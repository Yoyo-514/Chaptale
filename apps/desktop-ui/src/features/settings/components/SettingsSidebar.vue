<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

import { useSettingsStore, type SettingsSection } from '../store';

const settingsStore = useSettingsStore();

const sections: { id: SettingsSection; title: string; icon: string }[] = [
  {
    id: 'content',
    title: '专员与内容',
    icon: 'i-mingcute-user-setting-line'
  },
  {
    id: 'workspace',
    title: '作品',
    icon: 'i-mingcute-folder-2-line'
  },
  {
    id: 'llm',
    title: '模型',
    icon: 'i-mingcute-ai-line'
  },
  {
    id: 'prompt',
    title: 'Prompt',
    icon: 'i-mingcute-edit-3-line'
  },
  {
    id: 'webTools',
    title: '联网',
    icon: 'i-mingcute-earth-line'
  },
  {
    id: 'permissions',
    title: '权限',
    icon: 'i-mingcute-shield-shape-line'
  },
  {
    id: 'cloudSync',
    title: '云端备份',
    icon: 'i-mingcute-cloud-line'
  },
  {
    id: 'files',
    title: '配置文件',
    icon: 'i-mingcute-file-info-line'
  }
];
</script>

<template>
  <nav class="settings-panel-nav" aria-label="设置分类">
    <AppButton
      v-for="section in sections"
      :key="section.id"
      class="settings-nav-item"
      variant="ghost"
      :class="{ 'is-active': settingsStore.activeSection === section.id }"
      type="button"
      :aria-current="settingsStore.activeSection === section.id ? 'page' : undefined"
      @click="settingsStore.setSection(section.id)"
    >
      <span class="settings-nav-icon" :class="section.icon" aria-hidden="true" />
      <span class="settings-nav-title">{{ section.title }}</span>
    </AppButton>
  </nav>
</template>

<style scoped lang="scss">
.settings-panel-nav {
  @apply flex flex-col gap-1 overflow-auto border-r p-2;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
}

.settings-nav-item {
  @apply flex min-h-9 min-w-0 shrink-0 items-center justify-start gap-2.5 border-0 px-2.5 py-2 text-left outline-none transition-colors duration-150;
  height: auto;
  white-space: normal;

  background: transparent;
  border-color: transparent;
  border-radius: var(--radius-control);
  color: var(--foreground);
}

.settings-nav-item:hover {
  background: var(--surface-hover);
}

.settings-nav-item.is-active {
  background: var(--secondary);
  color: var(--primary-solid);
}

.settings-nav-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-nav-icon {
  @apply size-4 shrink-0;
}

.settings-nav-title {
  @apply font-medium;
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}
</style>
