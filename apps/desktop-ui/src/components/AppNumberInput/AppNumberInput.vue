<script setup lang="ts">
import { computed, inject, ref, useAttrs, watch } from 'vue';

import { cn } from '@/utils';
import { appFormContextKey } from '../AppForm/context';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: number;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    ariaLabel?: string;
  }>(),
  {
    step: 1,
    placeholder: '',
    disabled: false,
    invalid: false,
    ariaLabel: undefined,
    min: undefined,
    max: undefined
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: number | undefined];
}>();

const attrs = useAttrs();
const formContext = inject(appFormContextKey, undefined);
const displayValue = ref(formatValue(props.modelValue));
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const isInvalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const rootClassName = computed(() =>
  cn('app-number-input', isDisabled.value && 'is-disabled', isInvalid.value && 'is-invalid', attrs.class)
);
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

const canDecrease = computed(() => {
  if (isDisabled.value) {
    return false;
  }

  if (props.min === undefined || props.modelValue === undefined) {
    return true;
  }

  return props.modelValue > props.min;
});

const canIncrease = computed(() => {
  if (isDisabled.value) {
    return false;
  }

  if (props.max === undefined || props.modelValue === undefined) {
    return true;
  }

  return props.modelValue < props.max;
});

watch(
  () => props.modelValue,
  value => {
    displayValue.value = formatValue(value);
  }
);

function formatValue(value: number | undefined) {
  return value === undefined || Number.isNaN(value) ? '' : String(value);
}

function parseValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : props.modelValue;
}

function clampValue(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (props.min !== undefined && value < props.min) {
    return props.min;
  }

  if (props.max !== undefined && value > props.max) {
    return props.max;
  }

  return value;
}

function updateValue(value: number | undefined) {
  const nextValue = clampValue(value);
  displayValue.value = formatValue(nextValue);
  emit('update:modelValue', nextValue);
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  displayValue.value = target.value;
  emit('update:modelValue', parseValue(target.value));
}

function handleBlur() {
  updateValue(parseValue(displayValue.value));
}

function stepBy(direction: -1 | 1) {
  const baseValue = props.modelValue ?? props.min ?? 0;
  updateValue(baseValue + direction * props.step);
}
</script>

<template>
  <div
    :class="rootClassName"
    :style="attrs.style"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-number-input"
  >
    <input
      :value="displayValue"
      :placeholder="props.placeholder"
      :disabled="isDisabled"
      :aria-label="props.ariaLabel"
      :aria-invalid="isInvalid ? 'true' : undefined"
      v-bind="inputAttrs"
      class="app-number-input-control"
      inputmode="decimal"
      data-slot="app-number-input-control"
      @input="handleInput"
      @blur="handleBlur"
    />
    <div class="app-number-input-controls" data-slot="app-number-input-controls">
      <button
        class="app-number-input-button"
        type="button"
        tabindex="-1"
        aria-label="增加数值"
        :disabled="!canIncrease"
        @click="stepBy(1)"
      >
        <span class="i-mingcute-up-line size-3" aria-hidden="true" />
      </button>
      <button
        class="app-number-input-button"
        type="button"
        tabindex="-1"
        aria-label="减少数值"
        :disabled="!canDecrease"
        @click="stepBy(-1)"
      >
        <span class="i-mingcute-down-line size-3" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-number-input {
  @apply grid min-w-0 grid-cols-[minmax(0,1fr)_1.45rem] overflow-hidden border transition-colors duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control-sm);
  color: var(--foreground);
}

.app-number-input:focus-within {
  box-shadow: var(--input-focus-shadow);
}

.app-number-input.is-disabled {
  @apply cursor-not-allowed opacity-60;
}

.app-number-input.is-invalid {
  border-color: var(--destructive);
}

.app-number-input-control {
  @apply min-w-0 border-0 bg-transparent px-2 py-1.5 text-xs outline-none;

  color: inherit;
}

.app-number-input-control::placeholder {
  color: var(--muted-foreground);
}

.app-number-input-controls {
  @apply grid grid-rows-2 border-l;

  border-color: var(--border-subtle);
  background: color-mix(in srgb, var(--surface-muted) 78%, var(--background));
}

.app-number-input-button {
  @apply flex-center border-0 bg-transparent p-0 text-[0.65rem] outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30;

  color: var(--muted-foreground);
}

.app-number-input-button:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}

.app-number-input-button:first-child {
  border-bottom: 1px solid var(--border-subtle);
}
</style>
