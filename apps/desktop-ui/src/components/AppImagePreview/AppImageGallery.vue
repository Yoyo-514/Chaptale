<script setup lang="ts">
import { computed, ref } from 'vue';

import type { AppImagePreviewItem } from './types';

const props = withDefaults(
  defineProps<{
    items: AppImagePreviewItem[];
    /** 超过该数量时折叠为图片堆叠，鼠标悬停展开。 */
    stackThreshold?: number;
  }>(),
  {
    stackThreshold: 8
  }
);

const emit = defineEmits<{
  select: [index: number];
}>();

const expanded = ref(false);
const stackable = computed(() => props.items.length > props.stackThreshold);
const collapsed = computed(() => stackable.value && !expanded.value);

// 折叠时仅露出最上层图片和后面两层的边角，其余图片保持挂载但不可见，
// 避免 hover 展开时再触发一轮懒加载。
function behindStyle(index: number) {
  if (!collapsed.value || index === 0 || index > 2) {
    return undefined;
  }

  return {
    transform: `rotate(${index === 1 ? 2.5 : -2}deg) translate(${index * 6}px, ${index * 5}px)`,
    zIndex: String(3 - index)
  };
}
</script>

<template>
  <div
    v-if="props.items.length"
    :class="['app-image-gallery', collapsed && 'app-image-gallery-stacked']"
    data-slot="app-image-gallery"
    @mouseenter="expanded = true"
    @mouseleave="expanded = false"
    @focusin="expanded = true"
    @focusout="expanded = false"
  >
    <button
      v-for="(item, index) in props.items"
      :key="item.id"
      :class="[
        'app-image-gallery-item',
        collapsed && index > 0 && 'app-image-gallery-item-behind',
        collapsed && index > 2 && 'app-image-gallery-item-buried'
      ]"
      :style="behindStyle(index)"
      type="button"
      :aria-label="`预览 ${item.alt}`"
      @click.stop="emit('select', index)"
    >
      <img class="app-image-gallery-image" :src="item.thumbnailSrc" :alt="item.alt" loading="lazy" decoding="async" />
    </button>
    <span v-if="collapsed" class="app-image-gallery-count">共 {{ props.items.length }} 张</span>
  </div>
</template>

<style lang="scss">
.app-image-gallery {
  @apply flex w-full flex-wrap gap-2;
}

.app-image-gallery-item {
  @apply block max-w-full cursor-pointer overflow-hidden rounded-xl border p-0 outline-none transition-all duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
}

.app-image-gallery-item:hover,
.app-image-gallery-item:focus-visible {
  border-color: var(--primary);
  box-shadow: var(--input-focus-shadow);
}

.app-image-gallery-image {
  @apply block h-auto max-h-60 w-auto max-w-full object-contain;
}

.app-image-gallery-stacked {
  @apply relative inline-flex w-auto pb-2 pr-3;
}

.app-image-gallery-stacked .app-image-gallery-item:first-child {
  @apply relative z-4;
}

.app-image-gallery-item-behind {
  @apply absolute bottom-2 left-0 right-3 top-0;
}

.app-image-gallery-item-behind .app-image-gallery-image {
  @apply size-full max-h-none object-cover;
}

.app-image-gallery-item-buried {
  @apply pointer-events-none absolute inset-0 opacity-0;
}

.app-image-gallery-count {
  @apply pointer-events-none absolute bottom-4 right-5 z-5 rounded-full px-2 py-0.5 text-[11px];

  background: rgb(0 0 0 / 0.6);
  color: rgb(255 255 255 / 0.92);
}
</style>
