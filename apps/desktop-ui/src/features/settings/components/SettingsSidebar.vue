<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

import { useSettingsStore, type SettingsSection } from '../store';

const settingsStore = useSettingsStore();

const groups: { title: string; sections: { id: SettingsSection; title: string; icon: string }[] }[] = [
  {
    title: '写作',
    sections: [{ id: 'writing', title: '写作', icon: 'i-mingcute-quill-pen-line' }]
  },
  {
    title: '助手',
    sections: [
      { id: 'llm', title: '模型', icon: 'i-mingcute-ai-line' },
      { id: 'prompt', title: '写作指令', icon: 'i-mingcute-edit-3-line' },
      { id: 'skills', title: '技能', icon: 'i-mingcute-sparkles-line' },
      { id: 'mcp', title: 'MCP 服务', icon: 'i-mingcute-plugin-2-line' },
      { id: 'retrieval', title: '检索', icon: 'i-mingcute-database-search-line' },
      { id: 'permissions', title: '工具授权', icon: 'i-mingcute-shield-line' }
    ]
  },
  {
    title: '应用',
    sections: [
      { id: 'cloudSync', title: '云端账户', icon: 'i-mingcute-cloud-line' },
      { id: 'files', title: '应用数据', icon: 'i-mingcute-file-info-line' }
    ]
  }
];
</script>

<template>
  <nav class="settings-panel-nav" aria-label="设置分类">
    <div v-for="group in groups" :key="group.title" class="settings-nav-group" role="group" :aria-label="group.title">
      <p class="settings-nav-group-title" aria-hidden="true">{{ group.title }}</p>
      <AppButton
        v-for="section in group.sections"
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
    </div>
  </nav>
</template>

<style scoped lang="scss">
.settings-panel-nav {
  @apply flex flex-col gap-3 overflow-auto border-r p-2;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
}

.settings-nav-group {
  @apply flex shrink-0 flex-col gap-0.5;
}

.settings-nav-group-title {
  @apply m-0 px-2.5 pb-1 pt-1.5;

  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}

.settings-nav-item {
  @apply flex min-h-8 min-w-0 shrink-0 items-center justify-start gap-2.5 border-0 px-2.5 py-1.5 text-left outline-none transition-colors duration-150;
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

.settings-nav-icon {
  @apply size-4 shrink-0;
}

.settings-nav-title {
  @apply font-medium;
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}
</style>
