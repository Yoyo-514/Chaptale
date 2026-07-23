<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { cn } from '@/utils';

import type { AppFormGap, AppFormGridColumns } from './types';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    columns?: AppFormGridColumns;
    gap?: AppFormGap;
  }>(),
  {
    columns: 'responsive',
    gap: 'sm'
  }
);

const attrs = useAttrs();
const gridClassName = computed(() =>
  cn('app-form-grid', `app-form-grid-${props.columns}`, `app-form-grid-gap-${props.gap}`, attrs.class)
);
const gridAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <div v-bind="gridAttrs" :class="gridClassName" data-slot="app-form-grid">
    <slot />
  </div>
</template>

<style scoped lang="scss">
.app-form-grid {
  @apply grid min-w-0;
}

.app-form-grid-1 {
  @apply grid-cols-1;
}

.app-form-grid-2 {
  @apply grid-cols-2;
}

.app-form-grid-responsive {
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}

.app-form-grid-gap-sm {
  @apply gap-2;
}

.app-form-grid-gap-md {
  @apply gap-3;
}

.app-form-grid-gap-lg {
  @apply gap-4;
}
</style>
