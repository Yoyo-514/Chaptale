<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { computed, useAttrs, useSlots } from 'vue';

import { cn } from '@/utils';
import type { AppCollapsibleVariant } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    title?: string;
    description?: string;
    disabled?: boolean;
    unmountOnHide?: boolean;
    variant?: AppCollapsibleVariant;
    triggerClass?: string;
    contentClass?: string;
  }>(),
  {
    modelValue: false,
    title: undefined,
    description: undefined,
    disabled: false,
    unmountOnHide: true,
    variant: 'card',
    triggerClass: undefined,
    contentClass: undefined
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const attrs = useAttrs();
const slots = useSlots();
const hasCustomTrigger = computed(() => Boolean(slots.trigger));
const rootClassName = computed(() => cn('app-collapsible', `app-collapsible-${props.variant}`, attrs.class));
const triggerClassName = computed(() => cn('app-collapsible-trigger', props.triggerClass));
const contentClassName = computed(() => cn('app-collapsible-content', props.contentClass));
const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <CollapsibleRoot
    v-bind="rootAttrs"
    :open="props.modelValue"
    :disabled="props.disabled"
    :unmount-on-hide="props.unmountOnHide"
    :class="rootClassName"
    data-slot="app-collapsible"
    @update:open="emit('update:modelValue', $event)"
  >
    <CollapsibleTrigger v-if="hasCustomTrigger" as-child :class="triggerClassName" data-slot="app-collapsible-trigger">
      <slot name="trigger" :open="props.modelValue" :disabled="props.disabled" :trigger-class="triggerClassName" />
    </CollapsibleTrigger>

    <CollapsibleTrigger v-else :class="triggerClassName" data-slot="app-collapsible-trigger">
      <span class="app-collapsible-heading">
        <strong v-if="props.title || slots.title" class="app-collapsible-title">
          <slot name="title">{{ props.title }}</slot>
        </strong>
        <small v-if="props.description || slots.description" class="app-collapsible-description">
          <slot name="description">{{ props.description }}</slot>
        </small>
      </span>
      <slot name="icon" :open="props.modelValue">
        <span class="i-mingcute-down-line app-collapsible-chevron" aria-hidden="true" />
      </slot>
    </CollapsibleTrigger>

    <CollapsibleContent :class="contentClassName" data-slot="app-collapsible-content">
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style lang="scss">
.app-collapsible {
  @apply min-w-0 overflow-hidden;
}

.app-collapsible-card {
  @apply border;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.app-collapsible-trigger {
  @apply flex w-full items-center justify-between gap-3 border-0 bg-transparent px-3 py-2 text-left outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  color: var(--foreground);
}

.app-collapsible-trigger:hover:not(:disabled) {
  background: var(--surface-muted);
}

.app-collapsible-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-collapsible-heading {
  @apply flex min-w-0 flex-col gap-1;
}

.app-collapsible-title {
  @apply text-xs font-semibold;
}

.app-collapsible-description {
  @apply text-xs font-normal;

  color: var(--muted-foreground);
}

.app-collapsible-chevron {
  @apply shrink-0 text-base transition-transform duration-150;

  color: var(--muted-foreground);
}

.app-collapsible-trigger[data-state='open'] .app-collapsible-chevron {
  transform: rotate(180deg);
}

.app-collapsible-content {
  @apply min-w-0 p-3 pt-1;
}

.app-collapsible-plain .app-collapsible-trigger,
.app-collapsible-plain .app-collapsible-content {
  @apply px-0;
}
</style>
