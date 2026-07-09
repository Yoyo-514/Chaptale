<script setup lang="ts">
import { SelectContent, SelectPortal, SelectRoot, SelectTrigger, SelectValue } from 'reka-ui';
import { computed, useSlots } from 'vue';

import { cn } from '@/utils';
import AppScrollArea from '../AppScrollArea/AppScrollArea.vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    triggerClass?: string;
    contentClass?: string;
    contentSize?: 'sm' | 'md';
    sideOffset?: number;
    align?: 'start' | 'center' | 'end';
    disabled?: boolean;
  }>(),
  {
    modelValue: undefined,
    placeholder: undefined,
    triggerClass: undefined,
    contentClass: undefined,
    contentSize: 'md',
    sideOffset: 6,
    align: 'start',
    disabled: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const slots = useSlots();
const hasCustomTrigger = computed(() => Boolean(slots.trigger));
const triggerClassName = computed(() => cn('app-select-trigger', props.triggerClass));
const contentClassName = computed(() =>
  cn('app-select-content', `app-select-content-${props.contentSize}`, props.contentClass)
);
</script>

<template>
  <SelectRoot
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <SelectTrigger v-if="hasCustomTrigger" as-child :disabled="props.disabled">
      <slot
        name="trigger"
        :value="props.modelValue"
        :trigger-class="triggerClassName"
        :disabled="props.disabled"
        :data-disabled="props.disabled ? 'true' : undefined"
      />
    </SelectTrigger>
    <SelectTrigger v-else :class="triggerClassName" :data-disabled="props.disabled ? 'true' : undefined">
      <SelectValue :placeholder="props.placeholder" />
      <slot name="triggerIcon">
        <span class="i-mingcute-down-line app-select-trigger-icon" aria-hidden="true" />
      </slot>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" :class="contentClassName" :side-offset="props.sideOffset" :align="props.align">
        <AppScrollArea class="app-select-scroll" viewport-class="app-select-scroll-viewport">
          <div class="app-select-items" role="presentation">
            <slot />
          </div>
        </AppScrollArea>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style lang="scss">
.app-select-trigger {
  @apply flex w-full min-w-0 cursor-pointer items-center justify-between border text-left outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
}

.app-select-trigger[data-disabled='true'] {
  @apply cursor-not-allowed opacity-60;
}

.app-select-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-select-trigger-icon {
  @apply shrink-0;
}

.app-select-content {
  @apply z-50 border shadow-float;

  width: var(--reka-select-trigger-width, var(--radix-select-trigger-width, 16rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

.app-select-content-sm {
  @apply min-w-32;

  width: var(--reka-select-trigger-width, var(--radix-select-trigger-width, 10rem));
}

.app-select-content-md {
  @apply min-w-64;

  width: var(--reka-select-trigger-width, var(--radix-select-trigger-width, 24rem));
}

.app-select-scroll {
  @apply p-1;

  max-height: min(var(--reka-select-content-available-height, 16rem), 16rem);
}

.app-select-scroll-viewport {
  max-height: inherit;
}

.app-select-items {
  @apply flex flex-col gap-1;
}
</style>
