<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useCreationStore } from '@/features/creation';

import { chapterTitles } from './labels';

/** 候选的出处是本会话待接受的新正文：说明是哪一章，并可打开那一章的审阅。 */
const props = defineProps<{ chapterIds: readonly string[] }>();
const emit = defineEmits<{ open: [chapterId: string] }>();
const creation = useCreationStore();
const titles = computed(() => chapterTitles(props.chapterIds, creation.entries, creation.pendingEntries));
</script>

<template>
  <p class="draft-source" role="status">
    <span>出处{{ titles }}的新正文还没接受，先处理{{ chapterIds.length > 1 ? '这些章节' : '这一章' }}。</span>
    <AppButton size="xs" variant="ghost" @click="emit('open', chapterIds[0]!)">查看</AppButton>
  </p>
</template>

<style scoped>
.draft-source {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  font-size: var(--ui-caption-size);
}
.draft-source > span {
  flex: 1;
  min-width: 0;
}
</style>
