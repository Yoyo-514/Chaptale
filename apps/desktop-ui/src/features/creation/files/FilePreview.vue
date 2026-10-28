<script setup lang="ts">
import { computed } from 'vue';

import type { Entry } from '@chaptale/creation/contracts';

import { AppImageLightbox, type AppImagePreviewItem } from '@/components/AppImagePreview';

import { readFileBlob } from './files';

/** 应用内图片预览；entry 为 null 时关闭。 */
const props = defineProps<{ workId: string | null }>();
const entry = defineModel<Entry | null>('entry', { required: true });

const items = computed<AppImagePreviewItem[]>(() =>
  entry.value && props.workId
    ? [
        {
          id: entry.value.id,
          alt: entry.value.title,
          thumbnailSrc: '',
          loadOriginal: () => readFileBlob(props.workId!, entry.value!)
        }
      ]
    : []
);
const activeIndex = computed({
  get: () => (items.value.length ? 0 : null),
  set: index => {
    if (index === null) entry.value = null;
  }
});
</script>

<template>
  <AppImageLightbox v-model:active-index="activeIndex" :items="items" />
</template>
