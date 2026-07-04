<script setup lang="ts">
import type { WebsearchResult } from '@chaptale/shared';
import { computed, ref } from 'vue';

const props = defineProps<{
  content: string;
}>();

const showAll = ref(false);
const websearchResults = computed<WebsearchResult>(() => {
  try {
    return JSON.parse(props.content) as WebsearchResult;
  } catch {
    return [];
  }
});
const displayedResults = computed(() => {
  return showAll.value ? websearchResults.value : websearchResults.value.slice(0, 5);
});
</script>

<template>
  <div class="message-websearch-results">
    <p class="message-websearch-results-header">
      <span class="i-mingcute-earth-line" aria-hidden="true" />
      已搜索 {{ websearchResults.length }} 条结果
    </p>

    <div class="message-results-list">
      <a
        v-for="(result, index) in displayedResults"
        :key="index"
        class="message-result-item"
        :href="result.link"
        target="_blank"
        rel="noreferrer"
      >
        <p class="message-result-title">{{ result.title }}</p>
        <p class="message-result-description">{{ result.description }}</p>
      </a>
    </div>

    <div class="message-toggle">
      <span class="message-toggle-text" @click="showAll = !showAll">
        {{ showAll ? '收起' : '展开所有' }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.message-websearch-results {
  @apply flex max-w-full flex-col gap-1 rounded-xl border border-border-subtle bg-surface-acrylic py-3 text-foreground shadow-inset-highlight;
}

.message-websearch-results-header {
  @apply flex items-center gap-2 px-4 font-medium text-secondary-foreground;
}

.message-results-list {
  @apply flex flex-col;
}

.message-result-item {
  @apply mx-2 flex flex-col gap-1 rounded-md p-2 transition-colors duration-200 hover:bg-surface-muted;
}

.message-result-title {
  @apply font-medium text-primary-solid;
}

.message-result-description {
  @apply line-clamp-2 text-sm text-muted-foreground;
}

.message-toggle {
  @apply mt-1 flex justify-center;
}

.message-toggle-text {
  @apply cursor-pointer text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground;
}
</style>
