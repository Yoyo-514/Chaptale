<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui';
import { computed } from 'vue';

import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    active?: boolean;
    disabled?: boolean;
    itemClass?: string;
    density?: 'sm' | 'md';
  }>(),
  {
    active: false,
    disabled: false,
    itemClass: undefined,
    density: 'md'
  }
);

const itemClassName = computed(() => cn('app-dropdown-item', `app-dropdown-item-${props.density}`, props.itemClass));
</script>

<template>
  <DropdownMenuItem
    :class="itemClassName"
    :data-active="props.active"
    :data-disabled="props.disabled ? 'true' : undefined"
    :aria-disabled="props.disabled"
    :disabled="props.disabled"
    data-slot="app-dropdown-menu-item"
  >
    <slot />
  </DropdownMenuItem>
</template>

<style scoped lang="scss">
.app-dropdown-item {
  @apply cursor-pointer outline-none transition-colors duration-150;

  border-radius: var(--radius-control-sm);
  color: var(--foreground);
}

.app-dropdown-item-sm {
  @apply px-2.5 py-1.5 text-sm;
}

.app-dropdown-item-md {
  @apply flex flex-col gap-0.5 px-2 py-1.5 text-xs;
}

.app-dropdown-item[data-highlighted],
.app-dropdown-item:hover {
  background: var(--surface-hover);
}

.app-dropdown-item[data-active='true'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-dropdown-item[data-disabled],
.app-dropdown-item[data-disabled='true'],
.app-dropdown-item[aria-disabled='true'] {
  @apply cursor-not-allowed opacity-65;
}

.app-dropdown-item[data-disabled]:not([data-active='true']):hover,
.app-dropdown-item[data-disabled='true']:not([data-active='true']):hover,
.app-dropdown-item[aria-disabled='true']:not([data-active='true']):hover {
  background: transparent;
}
</style>
