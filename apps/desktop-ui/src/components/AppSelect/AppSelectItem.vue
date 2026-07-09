<script setup lang="ts">
import { SelectItem, SelectItemIndicator, SelectItemText } from 'reka-ui';
import { computed } from 'vue';

import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    value: string;
    disabled?: boolean;
    itemClass?: string;
    density?: 'sm' | 'md';
  }>(),
  {
    disabled: false,
    itemClass: undefined,
    density: 'md'
  }
);

const itemClassName = computed(() => cn('app-select-item', `app-select-item-${props.density}`, props.itemClass));
</script>

<template>
  <SelectItem :class="itemClassName" :value="props.value" :disabled="props.disabled">
    <span class="app-select-item-copy">
      <SelectItemText class="app-select-item-text">
        <slot />
      </SelectItemText>
    </span>
    <SelectItemIndicator class="app-select-item-indicator">
      <span class="i-mingcute-check-line" aria-hidden="true" />
    </SelectItemIndicator>
  </SelectItem>
</template>

<style scoped lang="scss">
.app-select-item {
  @apply relative cursor-pointer outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.4);
  color: var(--foreground);
}

.app-select-item-sm {
  @apply py-1.5 pr-7 pl-2.5 text-sm;
}

.app-select-item-md {
  @apply py-1.5 pr-7 pl-2 text-xs;
}

.app-select-item-copy {
  @apply flex min-w-0 flex-col gap-0.5;
}

.app-select-item-text {
  @apply flex min-w-0 flex-col gap-0.5;
}

.app-select-item-indicator {
  @apply flex-center absolute top-1/2 right-2 -translate-y-1/2 text-xs;
}

.app-select-item[data-highlighted],
.app-select-item:hover {
  background: var(--surface-muted);
}

.app-select-item[data-state='checked'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-select-item[data-disabled],
.app-select-item[aria-disabled='true'] {
  @apply cursor-not-allowed opacity-65;
}

.app-select-item[data-disabled]:not([data-state='checked']):hover,
.app-select-item[aria-disabled='true']:not([data-state='checked']):hover {
  background: transparent;
}
</style>
