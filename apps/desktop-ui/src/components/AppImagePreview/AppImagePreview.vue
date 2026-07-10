<script setup lang="ts">
import { ref } from 'vue';

import AppImageLightbox from './AppImageLightbox.vue';
import AppImageThumbnailGrid from './AppImageThumbnailGrid.vue';
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
  remove: [id: string];
}>();

const activeIndex = ref<number | null>(null);
</script>

<template>
  <AppImageThumbnailGrid
    :items="props.items"
    :removable="props.removable"
    @select="index => (activeIndex = index)"
    @remove="id => emit('remove', id)"
  />
  <AppImageLightbox v-model:active-index="activeIndex" :items="props.items" />
</template>
