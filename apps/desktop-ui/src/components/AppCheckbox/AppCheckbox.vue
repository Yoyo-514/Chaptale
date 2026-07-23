<script setup lang="ts">
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';
import { computed, inject, useAttrs } from 'vue';

import { cn } from '@/utils';

import { appFormContextKey } from '../AppForm/context';
import type { CheckboxValue } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: CheckboxValue;
    disabled?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
    size?: 'sm' | 'md';
    asChild?: boolean;
  }>(),
  {
    modelValue: false,
    disabled: false,
    invalid: false,
    ariaLabel: undefined,
    size: 'sm',
    asChild: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: CheckboxValue];
}>();

const attrs = useAttrs();
const formContext = inject(appFormContextKey, undefined);
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const isInvalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const resolvedAriaLabel = computed(() => props.ariaLabel ?? (attrs['aria-label'] as string | undefined));
const rootAttrs = computed(() => {
  const { class: _class, 'aria-label': _ariaLabel, ...rest } = attrs;
  return rest;
});
const rootClassName = computed(() =>
  cn(
    'app-checkbox',
    `app-checkbox-${props.size}`,
    isDisabled.value && 'is-disabled',
    isInvalid.value && 'is-invalid',
    attrs.class
  )
);
const iconClass = computed(() =>
  props.modelValue === 'indeterminate' ? 'i-mingcute-minimize-line' : 'i-mingcute-check-line'
);
</script>

<template>
  <CheckboxRoot
    v-if="props.asChild"
    v-bind="rootAttrs"
    :class="rootClassName"
    :model-value="props.modelValue"
    :disabled="isDisabled"
    :aria-label="resolvedAriaLabel"
    :aria-invalid="isInvalid ? 'true' : undefined"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-checkbox"
    as-child
    @update:model-value="emit('update:modelValue', $event)"
  >
    <span>
      <CheckboxIndicator class="app-checkbox-indicator">
        <span :class="iconClass" aria-hidden="true" />
      </CheckboxIndicator>
    </span>
  </CheckboxRoot>

  <CheckboxRoot
    v-else
    v-bind="rootAttrs"
    :class="rootClassName"
    :model-value="props.modelValue"
    :disabled="isDisabled"
    :aria-label="resolvedAriaLabel"
    :aria-invalid="isInvalid ? 'true' : undefined"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-checkbox"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <CheckboxIndicator class="app-checkbox-indicator">
      <span :class="iconClass" aria-hidden="true" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>

<style lang="scss">
.app-checkbox {
  @apply flex-center shrink-0 border outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  background: var(--input);
  border-color: var(--input-border);
  border-radius: var(--radius-checkbox);
}

.app-checkbox-sm {
  @apply size-4 text-xs;
}

.app-checkbox-md {
  @apply size-5 text-sm;

  border-radius: var(--radius-checkbox-active);
}

.app-checkbox[data-state='checked'],
.app-checkbox[data-state='indeterminate'] {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.app-checkbox:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-checkbox.is-invalid {
  border-color: var(--destructive);
}

.app-checkbox-indicator {
  @apply flex-center;
}
</style>
