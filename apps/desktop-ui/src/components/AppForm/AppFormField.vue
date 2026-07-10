<script setup lang="ts">
import { computed, inject, useId, useSlots } from 'vue';

import { cn } from '@/utils';
import { appFormContextKey } from './context';
import type { AppFormControlAttrs, AppFormFieldLayout, AppFormFieldSpan } from './types';

const props = withDefaults(
  defineProps<{
    label?: string;
    description?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    layout?: AppFormFieldLayout;
    span?: AppFormFieldSpan;
    controlId?: string;
  }>(),
  {
    label: undefined,
    description: undefined,
    error: undefined,
    required: false,
    disabled: false,
    invalid: false,
    layout: 'stacked',
    span: 1,
    controlId: undefined
  }
);

const slots = useSlots();
const formContext = inject(appFormContextKey, undefined);
const generatedId = useId();

const resolvedControlId = computed(() => props.controlId ?? `app-form-control-${generatedId}`);
const descriptionId = computed(() => `${resolvedControlId.value}-description`);
const errorId = computed(() => `${resolvedControlId.value}-error`);
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
const hasDescription = computed(() => Boolean(props.description) || Boolean(slots.description));
const hasError = computed(() => Boolean(props.error) || Boolean(slots.error));
const isInvalid = computed(() => props.invalid || hasError.value);
const describedBy = computed(() => {
  const ids = [
    hasDescription.value ? descriptionId.value : undefined,
    hasError.value ? errorId.value : undefined
  ].filter(Boolean);

  return ids.length > 0 ? ids.join(' ') : undefined;
});
const controlAttrs = computed<AppFormControlAttrs>(() => ({
  id: resolvedControlId.value,
  disabled: isDisabled.value || undefined,
  required: props.required || undefined,
  'aria-required': props.required ? 'true' : undefined,
  'aria-invalid': isInvalid.value ? 'true' : undefined,
  'aria-describedby': describedBy.value
}));
const fieldClassName = computed(() =>
  cn(
    'app-form-field',
    `app-form-field-${props.layout}`,
    `app-form-field-span-${props.span}`,
    isDisabled.value && 'is-disabled',
    isInvalid.value && 'is-invalid'
  )
);
</script>

<template>
  <div
    :class="fieldClassName"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    data-slot="app-form-field"
  >
    <label v-if="props.label || slots.label" class="app-form-field-label" :for="resolvedControlId">
      <slot name="label">{{ props.label }}</slot>
      <span v-if="props.required" class="app-form-field-required" aria-hidden="true">*</span>
    </label>

    <div class="app-form-field-content">
      <slot
        :control-attrs="controlAttrs"
        :id="resolvedControlId"
        :described-by="describedBy"
        :disabled="isDisabled"
        :invalid="isInvalid"
      />

      <p v-if="hasDescription" :id="descriptionId" class="app-form-field-description">
        <slot name="description">{{ props.description }}</slot>
      </p>

      <p v-if="hasError" :id="errorId" class="app-form-field-error" role="alert">
        <slot name="error">{{ props.error }}</slot>
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-form-field {
  @apply flex min-w-0 gap-1.5 text-xs;
}

.app-form-field-stacked {
  @apply flex-col;
}

.app-form-field-inline {
  @apply items-start gap-3;
}

.app-form-field-inline .app-form-field-label {
  @apply min-w-28 shrink-0 pt-1.5;
}

.app-form-field-span-2 {
  @apply col-span-2;
}

.app-form-field-span-full {
  grid-column: 1 / -1;
}

.app-form-field-label {
  @apply flex items-center gap-0.5 font-medium leading-4;

  color: var(--muted-foreground);
}

.app-form-field-required,
.app-form-field-error {
  color: var(--destructive);
}

.app-form-field-content {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.app-form-field-description,
.app-form-field-error {
  @apply m-0 text-xs leading-4;
}

.app-form-field-description {
  color: var(--muted-foreground);
}

.app-form-field.is-disabled {
  @apply opacity-60;
}
</style>
