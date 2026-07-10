<script setup lang="ts">
import type { AppImagePreviewItem } from './types';

const props = withDefaults(
  defineProps<{
    items: AppImagePreviewItem[];
    removable?: boolean;
  }>(),
  {
    removable: false
  }
);

const emit = defineEmits<{
  select: [index: number];
  remove: [id: string];
}>();
</script>

<template>
  <div v-if="props.items.length" class="app-image-thumbnail-grid" data-slot="app-image-thumbnail-grid">
    <div v-for="(item, index) in props.items" :key="item.id" class="app-image-thumbnail-item">
      <button
        class="app-image-thumbnail-trigger"
        type="button"
        :aria-label="`预览 ${item.alt}`"
        @click.stop="emit('select', index)"
      >
        <img
          class="app-image-thumbnail-image"
          :src="item.thumbnailSrc"
          :alt="item.alt"
          loading="lazy"
          decoding="async"
        />
      </button>
      <button
        v-if="props.removable"
        class="app-image-thumbnail-remove"
        type="button"
        :aria-label="`移除 ${item.alt}`"
        @click.stop="emit('remove', item.id)"
      >
        <span class="i-mingcute-close-line size-3" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.app-image-thumbnail-grid {
  @apply flex flex-wrap gap-2;
}

.app-image-thumbnail-item {
  @apply relative shrink-0;
}

/* 与文件附件卡片（p-1.5 + size-9 缩略图）保持一致的 48px 高度。 */
.app-image-thumbnail-trigger {
  @apply block size-12 cursor-pointer overflow-hidden rounded-lg border p-0 outline-none transition-colors duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
}

.app-image-thumbnail-trigger:hover,
.app-image-thumbnail-trigger:focus-visible {
  border-color: var(--primary);
  box-shadow: var(--input-focus-shadow);
}

.app-image-thumbnail-image {
  @apply size-full object-cover;
}

.app-image-thumbnail-remove {
  @apply flex-center absolute -right-1.5 -top-1.5 size-5 cursor-pointer rounded-full border-0 p-0 outline-none transition-colors duration-150;

  background: rgb(0 0 0 / 0.55);
  color: rgb(255 255 255 / 0.9);
}

.app-image-thumbnail-remove:hover {
  background: rgb(0 0 0 / 0.75);
  color: rgb(255 255 255 / 1);
}

.app-image-thumbnail-remove:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
