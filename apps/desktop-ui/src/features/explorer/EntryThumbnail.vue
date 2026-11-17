<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { Entry } from '@chaptale/creation/contracts';

import { useFileImage } from '@/features/creation';

/** 图片缩略图：滚动到可见时才读取文件，读取失败时显示图标；trashed 读取回收站中的文件。 */
const props = defineProps<{ workId: string; entry: Entry; trashed?: boolean }>();
const root = ref<HTMLElement>();
const visible = ref(false);
const src = useFileImage(
  computed(() => (visible.value ? { workId: props.workId, entry: props.entry, trashed: props.trashed } : null))
);

let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver(([item]) => {
    if (!item!.isIntersecting) return;
    visible.value = true;
    observer!.disconnect();
  });
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer!.disconnect());
</script>

<template>
  <span ref="root" class="entry-thumbnail" aria-hidden="true">
    <img v-if="src" :src="src" alt="" decoding="async" draggable="false" />
    <span v-else class="i-mingcute-pic-line entry-thumbnail-icon" />
  </span>
</template>

<style scoped>
.entry-thumbnail {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: var(--radius-control-sm);
  background: var(--surface-muted);
}
.entry-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.entry-thumbnail-icon {
  width: 15px;
  height: 15px;
}
</style>
