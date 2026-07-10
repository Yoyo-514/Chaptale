<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui';
import { computed, useAttrs } from 'vue';

import { cn } from '@/utils';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    viewportClass?: string;
    scrollbarClass?: string;
    thumbClass?: string;
    type?: 'auto' | 'always' | 'scroll' | 'hover';
  }>(),
  {
    viewportClass: undefined,
    scrollbarClass: undefined,
    thumbClass: undefined,
    type: 'hover'
  }
);

const attrs = useAttrs();
const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const rootClassName = computed(() => cn('app-scroll-area', attrs.class));
const viewportClassName = computed(() => cn('app-scroll-area-viewport', props.viewportClass));
const scrollbarClassName = computed(() => cn('app-scroll-area-scrollbar', props.scrollbarClass));
const thumbClassName = computed(() => cn('app-scroll-area-thumb', props.thumbClass));
</script>

<template>
  <ScrollAreaRoot v-bind="rootAttrs" :class="rootClassName" :type="props.type" data-slot="app-scroll-area">
    <ScrollAreaViewport :class="viewportClassName" data-slot="app-scroll-area-viewport">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar :class="scrollbarClassName" orientation="vertical" data-slot="app-scroll-area-scrollbar">
      <ScrollAreaThumb :class="thumbClassName" data-slot="app-scroll-area-thumb" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>

<style lang="scss">
.app-scroll-area {
  @apply min-h-0 overflow-hidden;
}

.app-scroll-area-viewport {
  @apply h-full min-h-0;

  max-height: inherit;
}

.app-scroll-area-scrollbar {
  @apply flex w-2 touch-none select-none p-0.5;

  background: transparent;
}

.app-scroll-area-thumb {
  @apply relative flex-1 transition-colors duration-150;

  background: color-mix(in srgb, var(--scrollbar-thumb) 82%, var(--primary) 18%);
  border-radius: calc(var(--radius) * 0.5);
}

.app-scroll-area-scrollbar:hover .app-scroll-area-thumb,
.app-scroll-area-thumb:hover {
  background: color-mix(in srgb, var(--scrollbar-thumb-hover) 86%, var(--primary) 14%);
}
</style>
