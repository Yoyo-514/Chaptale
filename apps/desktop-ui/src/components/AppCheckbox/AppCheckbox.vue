<script setup lang="ts">
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';
import { computed, useAttrs } from 'vue';

import { cn } from '@/utils';

defineOptions({
  inheritAttrs: false
});

type CheckboxValue = boolean | 'indeterminate';

const props = withDefaults(
  defineProps<{
    modelValue?: CheckboxValue;
    disabled?: boolean;
    ariaLabel?: string;
    size?: 'sm' | 'md';
    asChild?: boolean;
  }>(),
  {
    modelValue: false,
    disabled: false,
    ariaLabel: undefined,
    size: 'sm',
    asChild: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: CheckboxValue];
}>();

const attrs = useAttrs();
const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const rootClassName = computed(() => cn('app-checkbox', `app-checkbox-${props.size}`, attrs.class));
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
    :disabled="props.disabled"
    :aria-label="props.ariaLabel"
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
    :disabled="props.disabled"
    :aria-label="props.ariaLabel"
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
  border-radius: calc(var(--radius) * 0.25);
}

.app-checkbox-sm {
  @apply size-4 text-xs;
}

.app-checkbox-md {
  @apply size-5 text-sm;

  border-radius: calc(var(--radius) * 0.3);
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

.app-checkbox-indicator {
  @apply flex-center;
}
</style>
