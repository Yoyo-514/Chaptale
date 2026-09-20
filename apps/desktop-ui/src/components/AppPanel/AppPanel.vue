<script setup lang="ts">
import { AppScrollArea } from '@/components/AppScrollArea';

import AppPanelHeader from './AppPanelHeader.vue';

withDefaults(
  defineProps<{
    title: string;
    count?: number;
    subtitle?: string;
    titleHidden?: boolean;
  }>(),
  { count: undefined, subtitle: undefined, titleHidden: false }
);
</script>

<template>
  <section class="app-panel" :aria-label="title">
    <AppPanelHeader
      v-if="!titleHidden || subtitle || $slots.subtitle || $slots.actions"
      :title="title"
      :count="count"
      :subtitle="subtitle"
      :title-hidden="titleHidden"
    >
      <template v-if="$slots.subtitle" #subtitle><slot name="subtitle" /></template>
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </AppPanelHeader>
    <h2 v-else class="sr-only">{{ title }}</h2>
    <div v-if="$slots.toolbar" class="app-panel-toolbar"><slot name="toolbar" /></div>
    <AppScrollArea class="app-panel-scroll">
      <div class="app-panel-body"><slot /></div>
    </AppScrollArea>
    <footer v-if="$slots.footer" class="app-panel-footer"><slot name="footer" /></footer>
  </section>
</template>

<style lang="scss">
.app-panel {
  @apply flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  container-type: inline-size;
  container-name: side-panel;
}
// 筛选行：输入框吃满一行，下拉按内容宽度自动排布；窄面板时逐个换行。
.app-panel-toolbar {
  @apply grid shrink-0 gap-2 px-3 pb-2 pt-1;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
}
.app-panel-toolbar > .app-panel-toolbar-full {
  grid-column: 1 / -1;
}
.app-panel-scroll {
  @apply min-h-0 min-w-0 flex-1;
}
.app-panel-body {
  @apply min-w-0 pb-3;
  overflow-wrap: anywhere;
}
.app-panel-footer {
  @apply flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2;
  border-color: var(--border-subtle);
  background: var(--surface-muted);
}
.app-panel-footer-status {
  @apply mr-auto min-w-0 truncate;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
</style>
