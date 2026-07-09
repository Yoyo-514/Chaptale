<script setup lang="ts">
import { DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from 'reka-ui';
import { computed } from 'vue';

import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    triggerClass?: string;
    contentClass?: string;
    density?: 'sm' | 'md';
    contentSize?: 'sm' | 'md';
    sideOffset?: number;
    alignOffset?: number;
  }>(),
  {
    disabled: false,
    triggerClass: undefined,
    contentClass: undefined,
    density: 'md',
    contentSize: 'md',
    sideOffset: 6,
    alignOffset: -4
  }
);

const triggerClassName = computed(() =>
  cn('app-dropdown-sub-trigger', `app-dropdown-sub-trigger-${props.density}`, props.triggerClass)
);
const contentClassName = computed(() =>
  cn('app-dropdown-sub-content', `app-dropdown-sub-content-${props.contentSize}`, props.contentClass)
);
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger
      :class="triggerClassName"
      :disabled="props.disabled"
      :data-disabled="props.disabled ? 'true' : undefined"
      :aria-disabled="props.disabled"
    >
      <span class="app-dropdown-sub-trigger-copy">
        <slot name="trigger" />
      </span>
      <span class="i-mingcute-right-line app-dropdown-sub-trigger-icon" aria-hidden="true" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        :class="contentClassName"
        :side-offset="props.sideOffset"
        :align-offset="props.alignOffset"
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>

<style lang="scss">
.app-dropdown-sub-trigger {
  @apply flex min-w-0 cursor-pointer items-center justify-between gap-2 outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.4);
  color: var(--foreground);
}

.app-dropdown-sub-trigger-sm {
  @apply px-2.5 py-1.5 text-sm;
}

.app-dropdown-sub-trigger-md {
  @apply px-2 py-1.5 text-xs;
}

.app-dropdown-sub-trigger-copy {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}

.app-dropdown-sub-trigger-icon {
  @apply shrink-0 text-xs;

  color: var(--muted-foreground);
}

.app-dropdown-sub-trigger[data-highlighted],
.app-dropdown-sub-trigger:hover {
  background: var(--surface-muted);
}

.app-dropdown-sub-trigger[data-state='open'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-dropdown-sub-trigger[data-state='open'] .app-dropdown-sub-trigger-icon {
  color: var(--secondary-foreground);
  opacity: 0.78;
}

.app-dropdown-sub-trigger[data-disabled],
.app-dropdown-sub-trigger[data-disabled='true'],
.app-dropdown-sub-trigger[aria-disabled='true'] {
  @apply cursor-not-allowed opacity-65;
}

.app-dropdown-sub-trigger[data-disabled]:hover,
.app-dropdown-sub-trigger[data-disabled='true']:hover,
.app-dropdown-sub-trigger[aria-disabled='true']:hover {
  background: transparent;
}

.app-dropdown-sub-content {
  @apply z-50 flex flex-col gap-1 border p-1 shadow-float;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 16rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

.app-dropdown-sub-content-sm {
  @apply min-w-32;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 10rem));
}

.app-dropdown-sub-content-md {
  @apply min-w-64;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 24rem));
}
</style>
