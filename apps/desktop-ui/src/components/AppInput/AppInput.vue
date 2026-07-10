<script setup lang="ts">
import { computed, inject, useAttrs } from 'vue';

import { cn } from '@/utils';
import { appFormContextKey } from '../AppForm/context';
import type { AppInputSize, AppInputType, AppInputVariant } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    type?: AppInputType;
    size?: AppInputSize;
    variant?: AppInputVariant;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
  }>(),
  {
    modelValue: '',
    type: 'text',
    size: 'sm',
    variant: 'default',
    disabled: false,
    readonly: false,
    invalid: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const attrs = useAttrs();
const formContext = inject(appFormContextKey, undefined);
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const isInvalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const rootClassName = computed(() =>
  cn(
    'app-input',
    `app-input-${props.size}`,
    `app-input-${props.variant}`,
    isDisabled.value && 'is-disabled',
    isInvalid.value && 'is-invalid',
    attrs.class
  )
);
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div
    :class="rootClassName"
    :style="attrs.style"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-input"
  >
    <span v-if="$slots.prefix" class="app-input-prefix" data-slot="app-input-prefix">
      <slot name="prefix" />
    </span>

    <input
      v-bind="inputAttrs"
      :value="props.modelValue"
      :type="props.type"
      :disabled="isDisabled"
      :readonly="props.readonly"
      :aria-invalid="isInvalid ? 'true' : undefined"
      class="app-input-control"
      data-slot="app-input-control"
      @input="handleInput"
    />

    <span v-if="$slots.suffix" class="app-input-suffix" data-slot="app-input-suffix">
      <slot name="suffix" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.app-input {
  @apply flex min-w-0 items-center gap-2 border outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.app-input-default {
  background: var(--input);
  border-color: var(--input-border);
}

.app-input-muted {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.4);
}

.app-input-sm {
  @apply px-3 py-1.5 text-xs;
}

.app-input-md {
  @apply px-3 py-2 text-sm;
}

.app-input:focus-within {
  box-shadow: var(--input-focus-shadow);
}

.app-input.is-disabled {
  @apply cursor-not-allowed opacity-60;
}

.app-input.is-invalid {
  border-color: var(--destructive);
}

.app-input-control {
  @apply min-w-0 flex-1 border-0 bg-transparent p-0 text-inherit outline-none;

  color: inherit;
}

.app-input-control::placeholder {
  color: var(--muted-foreground);
}

.app-input-control:disabled {
  @apply cursor-not-allowed;
}

.app-input-prefix,
.app-input-suffix {
  @apply flex-center shrink-0;

  color: var(--muted-foreground);
}
</style>
