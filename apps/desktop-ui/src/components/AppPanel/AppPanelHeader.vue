<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    count?: number;
    subtitle?: string;
    /** 标签页已经写明面板名时，标题只留给读屏器，表头只放上下文与操作。 */
    titleHidden?: boolean;
  }>(),
  { count: undefined, subtitle: undefined, titleHidden: false }
);
</script>

<template>
  <header class="app-panel-header" :class="{ 'is-title-hidden': titleHidden }">
    <h2 class="app-panel-title" :class="{ 'sr-only': titleHidden }">
      <slot name="title">{{ title }}</slot>
    </h2>
    <span v-if="count !== undefined && !titleHidden" class="app-panel-count">{{ count }}</span>
    <span v-if="subtitle || $slots.subtitle" class="app-panel-subtitle" :title="subtitle">
      <slot name="subtitle">{{ subtitle }}</slot>
    </span>
    <div v-if="$slots.actions" class="app-panel-actions"><slot name="actions" /></div>
  </header>
</template>

<style lang="scss">
.app-panel-header {
  @apply flex h-9 shrink-0 items-center gap-2 pl-3 pr-1.5;
  font-size: var(--ui-font-size);
  color: var(--foreground);
}
.app-panel-title {
  @apply m-0 flex min-w-0 items-center gap-1.5 truncate font-semibold;
  font-size: inherit;
}
.app-panel-count {
  @apply shrink-0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
.app-panel-subtitle {
  @apply min-w-0 flex-1 truncate;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.app-panel-actions {
  @apply ml-auto flex shrink-0 items-center gap-0.5;
}
</style>
