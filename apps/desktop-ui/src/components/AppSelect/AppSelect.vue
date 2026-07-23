<script setup lang="ts">
import { SelectContent, SelectPortal, SelectRoot, SelectTrigger, SelectValue } from 'reka-ui';
import { computed, inject, useAttrs, useSlots } from 'vue';

import { useOverlayLayer } from '@/composables';
import { cn } from '@/utils';

import { appFormContextKey } from '../AppForm/context.ts';
import AppScrollArea from '../AppScrollArea/AppScrollArea.vue';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    triggerClass?: string;
    contentClass?: string;
    contentSize?: 'sm' | 'md';
    size?: 'sm' | 'md';
    variant?: 'default' | 'muted';
    sideOffset?: number;
    align?: 'start' | 'center' | 'end';
    disabled?: boolean;
    invalid?: boolean;
    name?: string;
    required?: boolean;
    autocomplete?: string;
  }>(),
  {
    modelValue: undefined,
    placeholder: undefined,
    triggerClass: undefined,
    contentClass: undefined,
    contentSize: 'md',
    size: undefined,
    variant: undefined,
    sideOffset: 6,
    align: 'start',
    disabled: false,
    invalid: false,
    name: undefined,
    required: false,
    autocomplete: undefined
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const slots = useSlots();
const attrs = useAttrs();
const formContext = inject(appFormContextKey, undefined);
/**
 * SelectContent 会通过 Portal 挂到 body，无法继承 Trigger 的 DOM stacking context。
 * 这里沿 Vue 组件树读取最近的浮层；其他 Portal 控件遇到同类问题时应复用该上下文，而不是全局抬高 popover。
 */
const overlayLayer = useOverlayLayer();
const contentStyle = computed(() => ({ zIndex: `var(--z-${overlayLayer})` }));
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const isInvalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const hasCustomTrigger = computed(() => Boolean(slots.trigger));
const triggerAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const triggerClassName = computed(() =>
  cn(
    'app-select-trigger',
    props.size && `app-select-trigger-${props.size}`,
    props.variant && `app-select-trigger-${props.variant}`,
    props.triggerClass,
    attrs.class
  )
);
const contentClassName = computed(() =>
  cn('app-select-content', `app-select-content-${props.contentSize}`, props.contentClass)
);
</script>

<template>
  <SelectRoot
    :model-value="props.modelValue"
    :disabled="isDisabled"
    :name="props.name"
    :required="props.required"
    :autocomplete="props.autocomplete"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <SelectTrigger
      v-if="hasCustomTrigger"
      v-bind="triggerAttrs"
      as-child
      :disabled="isDisabled"
      :aria-invalid="isInvalid ? 'true' : undefined"
      :data-disabled="isDisabled || undefined"
      :data-invalid="isInvalid || undefined"
      data-slot="app-select"
    >
      <slot
        name="trigger"
        :value="props.modelValue"
        :trigger-class="triggerClassName"
        :disabled="isDisabled"
        :data-disabled="isDisabled ? 'true' : undefined"
        :invalid="isInvalid"
      />
    </SelectTrigger>
    <SelectTrigger
      v-else
      v-bind="triggerAttrs"
      :class="triggerClassName"
      :disabled="isDisabled"
      :aria-invalid="isInvalid ? 'true' : undefined"
      :data-disabled="isDisabled || undefined"
      :data-invalid="isInvalid || undefined"
      data-slot="app-select"
    >
      <SelectValue :placeholder="props.placeholder" />
      <slot name="triggerIcon">
        <span class="i-mingcute-down-line app-select-trigger-icon" aria-hidden="true" />
      </slot>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :class="contentClassName"
        :style="contentStyle"
        :side-offset="props.sideOffset"
        :align="props.align"
      >
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

  border-radius: var(--radius-control);
}

.app-select-trigger-sm {
  @apply px-3 py-1.5 text-xs;
}

.app-select-trigger-md {
  @apply px-3 py-2 text-sm;
}

.app-select-trigger-default {
  background: var(--input);
  border-color: var(--input-border);
  color: var(--foreground);
}

.app-select-trigger-muted {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control-sm);
  color: var(--foreground);
}

.app-select-trigger[data-disabled='true'] {
  @apply cursor-not-allowed opacity-60;
}

.app-select-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-select-trigger[data-invalid='true'] {
  border-color: var(--destructive);
}

.app-select-trigger-icon {
  @apply shrink-0;
}

.app-select-content {
  @apply border shadow-$shadow-float;

  width: var(--reka-select-trigger-width, var(--radix-select-trigger-width, 16rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
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
