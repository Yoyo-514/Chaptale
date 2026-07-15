<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { cn } from '@/utils';
import type { AppButtonSize, AppButtonVariant } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    variant?: AppButtonVariant;
    size?: AppButtonSize;
    selected?: boolean;
    icon?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    block?: boolean;
  }>(),
  {
    variant: 'secondary',
    size: 'sm',
    selected: false,
    icon: false,
    disabled: false,
    type: 'button',
    block: false
  }
);

const attrs = useAttrs();
const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const buttonClassName = computed(() =>
  cn(
    'app-button',
    `app-button-${props.variant}`,
    `app-button-${props.size}`,
    props.icon && 'app-button-icon',
    props.selected && 'app-button-selected',
    props.block && 'app-button-block',
    attrs.class
  )
);
</script>

<template>
  <button
    v-bind="rootAttrs"
    :type="props.type"
    :disabled="props.disabled"
    :class="buttonClassName"
    :data-icon="props.icon ? 'true' : undefined"
    data-slot="app-button"
  >
    <slot />
  </button>
</template>

<style lang="scss">
.app-button {
  @apply inline-flex min-w-0 shrink-0 items-center justify-center gap-2 border font-medium outline-none transition-colors duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60;

  border-radius: var(--radius-control);
}

.app-button-xs {
  @apply px-2 py-1 text-xs;
}

.app-button-sm {
  @apply px-3 py-1.5 text-xs;
}

.app-button-md {
  @apply px-4 py-2 text-sm;
}

.app-button-lg {
  @apply px-5 py-2.5 text-sm;

  border-radius: calc(var(--radius) * 0.6);
}

.app-button-primary {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.app-button-primary:hover:not(:disabled) {
  background: var(--primary-solid-hover);
}

.app-button-secondary {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.app-button-secondary:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-button-danger {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.app-button-danger:hover:not(:disabled) {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.app-button-outline {
  background: transparent;
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.app-button-outline:hover:not(:disabled) {
  background: var(--surface-muted);
}

.app-button-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--muted-foreground);
}

.app-button-ghost:hover:not(:disabled) {
  background: var(--surface-muted);
  color: var(--foreground);
}

.app-button-link {
  @apply p-0;

  background: transparent;
  border-color: transparent;
  color: var(--primary);
  text-underline-offset: 4px;
}

.app-button-link:hover:not(:disabled) {
  text-decoration-line: underline;
}

.app-button-icon {
  @apply aspect-square gap-0 p-0;
}

.app-button-icon.app-button-xs {
  @apply size-6;
}

.app-button-icon.app-button-sm {
  @apply size-7;
}

.app-button-icon.app-button-md {
  @apply size-8;
}

.app-button-icon.app-button-lg {
  @apply size-9;
}

.app-button-selected {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-button-block {
  @apply w-full;
}

.app-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
