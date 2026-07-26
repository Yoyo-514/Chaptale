<script setup lang="ts">
import { computed, useId, useSlots } from 'vue';

import { AppCheckbox } from '@/components/AppCheckbox';
import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description?: string;
    disabled?: boolean;
    wide?: boolean;
    contentColumns?: 1 | 'responsive';
  }>(),
  {
    description: undefined,
    disabled: false,
    wide: false,
    contentColumns: 'responsive'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const slots = useSlots();
const generatedId = useId();
const controlId = `settings-toggle-${generatedId}`;
const rootClassName = computed(() => cn('settings-toggle-field', props.wide && 'is-wide'));
</script>

<template>
  <div :class="rootClassName" data-slot="settings-toggle-field">
    <label :for="controlId" class="settings-toggle-field-label">
      <AppCheckbox
        :id="controlId"
        class="settings-toggle-field-checkbox"
        :model-value="props.modelValue"
        :disabled="props.disabled"
        @update:model-value="emit('update:modelValue', $event === true)"
      />
      <span class="settings-toggle-field-copy">
        <strong>{{ props.title }}</strong>
        <small v-if="props.description">{{ props.description }}</small>
      </span>
    </label>

    <div
      v-if="props.modelValue && slots.default"
      :class="cn('settings-toggle-field-content', `settings-toggle-field-content-${props.contentColumns}`)"
      data-slot="settings-toggle-field-content"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.settings-toggle-field {
  @apply min-w-0;
}

.settings-toggle-field.is-wide {
  grid-column: 1 / -1;
}

.settings-toggle-field-label {
  @apply flex min-w-0 items-start gap-2 py-2;
}

.settings-toggle-field-checkbox {
  @apply mt-0.5;
}

.settings-toggle-field-copy {
  @apply flex min-w-0 flex-col gap-1 text-xs;
}

.settings-toggle-field-copy small {
  color: var(--muted-foreground);
}

.settings-toggle-field-content {
  @apply mt-1 grid gap-2 border-l pl-6;

  border-color: var(--border-subtle);
}

.settings-toggle-field-content-responsive {
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}

.settings-toggle-field-content-1 {
  grid-template-columns: minmax(0, 1fr);
}
</style>
