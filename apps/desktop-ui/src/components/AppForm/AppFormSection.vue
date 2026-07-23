<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue';

import { cn } from '@/utils';

import type { AppFormGap } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    as?: 'section' | 'fieldset';
    disabled?: boolean;
    gap?: AppFormGap;
  }>(),
  {
    title: undefined,
    description: undefined,
    as: 'section',
    disabled: false,
    gap: 'sm'
  }
);

const slots = useSlots();
const attrs = useAttrs();
const titleTag = computed(() => (props.as === 'fieldset' ? 'legend' : 'h3'));
const hasTitle = computed(() => Boolean(props.title) || Boolean(slots.title));
const hasDescription = computed(() => Boolean(props.description) || Boolean(slots.description));
const sectionClassName = computed(() =>
  cn('app-form-section', `app-form-section-gap-${props.gap}`, props.disabled && 'is-disabled', attrs.class)
);
const sectionAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <component
    :is="props.as"
    v-bind="sectionAttrs"
    :class="sectionClassName"
    :disabled="props.as === 'fieldset' ? props.disabled : undefined"
    :aria-disabled="props.disabled || undefined"
    :data-disabled="props.disabled || undefined"
    data-slot="app-form-section"
  >
    <component :is="titleTag" v-if="hasTitle" class="app-form-section-title" data-slot="app-form-section-title">
      <slot name="title">{{ props.title }}</slot>
    </component>

    <p v-if="hasDescription" class="app-form-section-description" data-slot="app-form-section-description">
      <slot name="description">{{ props.description }}</slot>
    </p>

    <div v-if="$slots.actions" class="app-form-section-actions" data-slot="app-form-section-actions">
      <slot name="actions" />
    </div>

    <div class="app-form-section-content" data-slot="app-form-section-content">
      <slot />
    </div>
  </component>
</template>

<style scoped lang="scss">
.app-form-section {
  @apply relative m-0 flex min-w-0 flex-col border-0 p-0;
}

.app-form-section-gap-sm {
  @apply gap-2;
}

.app-form-section-gap-md {
  @apply gap-3;
}

.app-form-section-gap-lg {
  @apply gap-4;
}

.app-form-section-title {
  @apply m-0 w-full p-0 text-sm font-semibold;

  color: var(--foreground);
}

.app-form-section-description {
  @apply m-0 text-xs leading-5;

  color: var(--muted-foreground);
}

.app-form-section-actions {
  @apply flex min-w-0 items-center justify-end gap-2;
}

.app-form-section-content {
  @apply flex min-w-0 flex-col gap-2;
}

.app-form-section.is-disabled:not(fieldset) {
  @apply opacity-60;
}
</style>
