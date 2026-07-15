<script setup lang="ts">
import { computed, inject, ref, useAttrs } from 'vue';

import { cn } from '@/utils';
import { appFormContextKey } from '../AppForm/context';
import type { AppTextareaExpose, AppTextareaResize, AppTextareaSize, AppTextareaVariant } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    rows?: number;
    resize?: AppTextareaResize;
    size?: AppTextareaSize;
    variant?: AppTextareaVariant;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
  }>(),
  {
    modelValue: '',
    rows: 3,
    resize: 'vertical',
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
const textareaElement = ref<HTMLTextAreaElement | null>(null);
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const isInvalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const textareaClassName = computed(() =>
  cn(
    'app-textarea',
    `app-textarea-${props.size}`,
    `app-textarea-${props.variant}`,
    `app-textarea-resize-${props.resize}`,
    isDisabled.value && 'is-disabled',
    isInvalid.value && 'is-invalid',
    attrs.class
  )
);
const textareaAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function focus(options?: FocusOptions) {
  textareaElement.value?.focus(options);
}

function select() {
  textareaElement.value?.select();
}

function getElement() {
  return textareaElement.value;
}

defineExpose<AppTextareaExpose>({
  focus,
  select,
  getElement
});
</script>

<template>
  <textarea
    ref="textareaElement"
    v-bind="textareaAttrs"
    :value="props.modelValue"
    :rows="props.rows"
    :disabled="isDisabled"
    :readonly="props.readonly"
    :aria-invalid="isInvalid ? 'true' : undefined"
    :class="textareaClassName"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-textarea"
    @input="handleInput"
  />
</template>

<style scoped lang="scss">
.app-textarea {
  @apply block min-w-0 w-full border outline-none transition-colors duration-150;

  border-radius: var(--radius-control);
  color: var(--foreground);
}

.app-textarea-default {
  background: var(--input);
  border-color: var(--input-border);
}

.app-textarea-muted {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control-sm);
}

.app-textarea-plain {
  background: transparent;
  border-color: transparent;
}

.app-textarea-sm {
  @apply px-3 py-1.5 text-xs leading-5;
}

.app-textarea-md {
  @apply px-3 py-2 text-sm leading-5;
}

.app-textarea-lg {
  @apply px-4 py-3 text-base leading-5;
}

.app-textarea:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-textarea-plain:focus-visible {
  box-shadow: none;
}

.app-textarea.is-disabled {
  @apply cursor-not-allowed opacity-60;
}

.app-textarea.is-invalid {
  border-color: var(--destructive);
}

.app-textarea::placeholder {
  color: var(--muted-foreground);
}

.app-textarea-resize-none {
  @apply resize-none;
}

.app-textarea-resize-vertical {
  resize: vertical;
}
</style>
