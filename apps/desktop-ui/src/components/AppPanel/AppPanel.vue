<script setup lang="ts">
import { AppScrollArea } from '@/components/AppScrollArea';

defineProps<{ title: string; count?: number }>();
</script>

<template>
  <section class="app-panel" :aria-label="title">
    <header class="app-panel-header">
      <h2 class="app-panel-title">{{ title }}</h2>
      <span v-if="count !== undefined" class="app-panel-count">{{ count }}</span>
      <div v-if="$slots.actions" class="app-panel-actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.toolbar" class="app-panel-toolbar"><slot name="toolbar" /></div>
    <AppScrollArea class="app-panel-scroll">
      <div class="app-panel-body"><slot /></div>
    </AppScrollArea>
    <footer v-if="$slots.footer" class="app-panel-footer"><slot name="footer" /></footer>
  </section>
</template>

<style scoped lang="scss">
.app-panel {
  @apply flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  container-type: inline-size;
  container-name: side-panel;
}
.app-panel-header {
  @apply flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-1.5;
  border-color: var(--border-subtle);
}
.app-panel-title {
  @apply m-0 min-w-0 font-semibold;
  font-size: inherit;
  overflow-wrap: anywhere;
}
.app-panel-count {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
.app-panel-actions {
  @apply ml-auto flex shrink-0 items-center gap-1;
}
.app-panel-toolbar {
  @apply min-w-0 shrink-0 border-b;
  border-color: var(--border-subtle);
}
.app-panel-scroll {
  @apply min-h-0 min-w-0 flex-1;
}
.app-panel-body {
  @apply min-w-0;
  overflow-wrap: anywhere;
}
.app-panel-footer {
  @apply flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2.5;
  border-color: var(--border-subtle);
}
</style>
