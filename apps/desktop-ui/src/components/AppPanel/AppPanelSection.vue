<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string;
    count?: number;
    /** 默认展开；传入 false 时首次渲染即折叠。 */
    open?: boolean;
    /** 分节头的语义标签：右栏叙述性分节用 h3，左栏纯分组保持 span。 */
    heading?: boolean;
  }>(),
  { count: undefined, open: true, heading: false }
);
const emit = defineEmits<{ toggle: [open: boolean] }>();
function onToggle(event: Event) {
  emit('toggle', (event.currentTarget as HTMLDetailsElement).open);
}
</script>

<template>
  <details class="app-panel-section" :open="props.open" @toggle="onToggle">
    <summary class="app-panel-section-summary">
      <span class="i-mingcute-right-line app-panel-section-chevron" aria-hidden="true" />
      <component :is="heading ? 'h3' : 'span'" class="app-panel-section-title">{{ title }}</component>
      <span v-if="count !== undefined" class="app-panel-section-count">{{ count }}</span>
      <span v-if="$slots.actions" class="app-panel-section-actions" @click.prevent.stop><slot name="actions" /></span>
    </summary>
    <div class="app-panel-section-body"><slot /></div>
  </details>
</template>

<style lang="scss">
.app-panel-section {
  @apply min-w-0;
}
.app-panel-section-summary {
  @apply flex h-8 cursor-pointer select-none items-center gap-1 pl-2 pr-1.5 outline-none;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  list-style: none;
}
.app-panel-section-summary::-webkit-details-marker {
  display: none;
}
.app-panel-section-summary:hover {
  background: var(--surface-hover);
}
.app-panel-section-summary:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.app-panel-section-chevron {
  @apply size-3.5 shrink-0 transition-transform;
  transition-duration: var(--motion-duration);
}
.app-panel-section[open] > .app-panel-section-summary .app-panel-section-chevron {
  transform: rotate(90deg);
}
.app-panel-section-title {
  @apply m-0 min-w-0 flex-1 truncate font-semibold;
  font-size: inherit;
  color: var(--foreground);
}
.app-panel-section-count {
  @apply shrink-0 pr-1;
  font-variant-numeric: tabular-nums;
}
.app-panel-section-actions {
  @apply flex shrink-0 items-center gap-0.5;
}
.app-panel-section-body {
  @apply min-w-0;
}
</style>
