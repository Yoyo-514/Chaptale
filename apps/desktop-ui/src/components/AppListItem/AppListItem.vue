<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

defineProps<{ title: string; description?: string; meta?: string; selected?: boolean }>();
</script>

<template>
  <AppButton variant="ghost" class="app-list-item" :selected="selected">
    <span v-if="$slots.leading" class="app-list-item-leading"><slot name="leading" /></span>
    <span class="app-list-item-copy">
      <strong class="app-list-item-title">{{ title }}</strong>
      <span v-if="description || $slots.description" class="app-list-item-description">
        <slot name="description">{{ description }}</slot>
      </span>
      <small v-if="meta || $slots.meta" class="app-list-item-meta"
        ><slot name="meta">{{ meta }}</slot></small
      >
    </span>
    <slot name="trailing" />
  </AppButton>
</template>

<style scoped lang="scss">
.app-list-item {
  @apply flex h-auto w-full min-w-0 items-start justify-start gap-2.5 rounded-none border-0 border-b px-3 py-2.5 text-left font-normal;
  border-color: var(--border-subtle);
  white-space: normal;
  overflow-wrap: anywhere;
}
.app-list-item-leading {
  @apply mt-0.5 flex size-4 shrink-0 items-center justify-center;
  color: var(--muted-foreground);
}
.app-list-item-copy {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}
.app-list-item-title {
  @apply font-medium;
  color: var(--foreground);
  line-height: 1.5;
}
.app-list-item-description {
  @apply line-clamp-3;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.6;
}
.app-list-item-meta {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
</style>
