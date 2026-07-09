<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';
import { computed } from 'vue';

import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    triggerClass?: string;
    contentClass?: string;
    contentSize?: 'sm' | 'md';
    sideOffset?: number;
    align?: 'start' | 'center' | 'end';
    disabled?: boolean;
  }>(),
  {
    triggerClass: undefined,
    contentClass: undefined,
    contentSize: 'md',
    sideOffset: 6,
    align: 'start',
    disabled: false
  }
);

const triggerClassName = computed(() => cn('app-dropdown-trigger', props.triggerClass));
const contentClassName = computed(() =>
  cn('app-dropdown-content', `app-dropdown-content-${props.contentSize}`, props.contentClass)
);
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child :disabled="props.disabled">
      <slot
        name="trigger"
        :trigger-class="triggerClassName"
        :disabled="props.disabled"
        :data-disabled="props.disabled ? 'true' : undefined"
      />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent :class="contentClassName" :side-offset="props.sideOffset" :align="props.align">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style lang="scss">
.app-dropdown-trigger {
  @apply flex w-full min-w-0 cursor-pointer items-center justify-between border text-left outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
}

.app-dropdown-trigger[data-disabled='true'] {
  @apply cursor-not-allowed opacity-60;
}

.app-dropdown-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-dropdown-content {
  @apply z-50 flex flex-col gap-1 border p-1 shadow-float;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 16rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

.app-dropdown-content-sm {
  @apply min-w-32;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 10rem));
}

.app-dropdown-content-md {
  @apply min-w-64;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 24rem));
}
</style>
