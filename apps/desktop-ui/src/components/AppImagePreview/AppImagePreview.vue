<script setup lang="ts">
import { ref } from 'vue';

import AppImageGallery from './AppImageGallery.vue';
import AppImageLightbox from './AppImageLightbox.vue';
import AppImageThumbnailGrid from './AppImageThumbnailGrid.vue';
import type { AppImagePreviewItem } from './types';

const props = withDefaults(
  defineProps<{
    items: AppImagePreviewItem[];
    removable?: boolean;
    /** thumbnail：紧凑缩略图网格；large：内联大图，超过 8 张折叠为堆叠。 */
    variant?: 'thumbnail' | 'large';
  }>(),
  {
    removable: false,
    variant: 'thumbnail'
  }
);

const emit = defineEmits<{
  remove: [id: string];
}>();

const activeIndex = ref<number | null>(null);
</script>

<template>
  <AppImageGallery v-if="props.variant === 'large'" :items="props.items" @select="index => (activeIndex = index)" />
  <AppImageThumbnailGrid
    v-else
    :items="props.items"
    :removable="props.removable"
    @select="index => (activeIndex = index)"
    @remove="id => emit('remove', id)"
  />
  <AppImageLightbox v-model:active-index="activeIndex" :items="props.items" />
</template>
