<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import type { AppImagePreviewItem } from './types';

const props = defineProps<{
  items: AppImagePreviewItem[];
  activeIndex: number | null;
}>();

const emit = defineEmits<{
  select: [index: number];
}>();

const rootRef = ref<HTMLElement | null>(null);

watch(
  () => props.activeIndex,
  async () => {
    await nextTick();
    const active = rootRef.value?.querySelector('[data-active="true"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  },
  { immediate: true }
);
</script>

<template>
  <div ref="rootRef" class="app-image-lightbox-filmstrip" data-slot="app-image-lightbox-filmstrip">
    <button
      v-for="(item, index) in props.items"
      :key="item.id"
      class="app-image-lightbox-thumb"
      type="button"
      :data-active="index === props.activeIndex ? 'true' : undefined"
      :aria-label="`查看 ${item.alt}`"
      :aria-current="index === props.activeIndex"
      @click="emit('select', index)"
    >
      <img
        class="app-image-lightbox-thumb-image"
        :src="item.thumbnailSrc"
        :alt="item.alt"
        loading="lazy"
        decoding="async"
      />
    </button>
  </div>
</template>

<style lang="scss">
.app-image-lightbox-filmstrip {
  @apply flex max-w-full gap-2 overflow-x-auto rounded-xl p-2;

  background: rgb(255 255 255 / 0.06);
}

.app-image-lightbox-thumb {
  @apply size-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 border-transparent p-0 outline-none transition-opacity duration-150;

  opacity: 0.55;
}

.app-image-lightbox-thumb:hover {
  opacity: 0.85;
}

.app-image-lightbox-thumb:focus-visible {
  border-color: rgb(255 255 255 / 0.6);
  opacity: 1;
}

.app-image-lightbox-thumb[data-active='true'] {
  border-color: rgb(255 255 255 / 0.9);
  opacity: 1;
}

.app-image-lightbox-thumb-image {
  @apply size-full object-cover;
}
</style>
