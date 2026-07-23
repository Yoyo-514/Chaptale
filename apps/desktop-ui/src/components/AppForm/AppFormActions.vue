<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { cn } from '@/utils';

import type { AppFormActionsAlign } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    align?: AppFormActionsAlign;
    compact?: boolean;
    sticky?: boolean;
  }>(),
  {
    align: 'end',
    compact: false,
    sticky: false
  }
);

const attrs = useAttrs();
const actionsClassName = computed(() =>
  cn(
    'app-form-actions',
    `app-form-actions-${props.align}`,
    props.compact && 'app-form-actions-compact',
    props.sticky && 'app-form-actions-sticky',
    attrs.class
  )
);
const actionsAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <div v-bind="actionsAttrs" :class="actionsClassName" data-slot="app-form-actions">
    <div v-if="$slots.leading" class="app-form-actions-leading" data-slot="app-form-actions-leading">
      <slot name="leading" />
    </div>
    <div class="app-form-actions-main" data-slot="app-form-actions-main">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-form-actions {
  @apply flex min-w-0 flex-wrap items-center gap-3;
}

.app-form-actions-start {
  @apply justify-start;
}

.app-form-actions-center {
  @apply justify-center;
}

.app-form-actions-end {
  @apply justify-end;
}

.app-form-actions-between {
  @apply justify-between;
}

.app-form-actions-compact {
  @apply gap-1.5;
}

.app-form-actions-sticky {
  @apply sticky bottom-0 z-$z-sticky-surface border-t py-2;

  background: color-mix(in srgb, var(--popover) 92%, transparent);
  border-color: var(--border-subtle);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.app-form-actions-leading,
.app-form-actions-main {
  @apply flex min-w-0 items-center gap-2;
}

.app-form-actions-leading {
  @apply mr-auto;
}
</style>
