<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { computed, ref } from 'vue';

import { cn } from '@/utils';
import type { ChatMessage, WebsearchResult } from '@chaptale/shared';

import 'github-markdown-css/github-markdown.css';

const props = defineProps<{
  message: ChatMessage;
}>();

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const showAll = ref(false);
const isUserMessage = computed(() => props.message.type === 'user');
const assistantHtml = computed(() => {
  if (props.message.type !== 'assistant') return '';

  return markdown.render(props.message.payload.content);
});

const websearchResults = computed<WebsearchResult>(() => {
  if (props.message.type !== 'tool_result' || props.message.payload.name !== 'websearch') return [];

  try {
    return JSON.parse(props.message.payload.content) as WebsearchResult;
  } catch {
    return [];
  }
});

const displayedResults = computed(() => {
  return showAll.value ? websearchResults.value : websearchResults.value.slice(0, 5);
});
</script>

<template>
  <div :class="cn('message-container', isUserMessage && 'message-container-user')">
    <p v-if="message.type === 'user'" class="message-user">{{ message.payload.content }}</p>

    <div v-else-if="message.type === 'assistant'" class="markdown-body" v-html="assistantHtml" />

    <div
      v-else-if="message.type === 'tool_call' && message.payload.name === 'websearch'"
      class="message-websearch-keywords"
    >
      <span class="i-lucide-search message-websearch-keywords-icon" aria-hidden="true" />
      <span class="message-websearch-keywords-text">
        正在搜索：
        <span class="message-websearch-keywords-query">{{ message.payload.args.keywords }}</span>
      </span>
    </div>

    <div
      v-else-if="message.type === 'tool_result' && message.payload.name === 'websearch'"
      class="message-websearch-results"
    >
      <p class="message-websearch-results-header">
        <span class="i-lucide-globe" aria-hidden="true" />
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
  </div>
</template>

<style scoped lang="scss">
.message-container {
  @apply flex;
}

.message-container-user {
  @apply justify-end;
}

.message-user {
  @apply rounded-full bg-neutral-100 px-4 py-1.5;
}

.message-websearch-keywords {
  @apply flex items-center gap-2 truncate rounded-full bg-neutral-100 px-4 py-1.5;
}

.message-websearch-keywords-icon {
  @apply shrink-0;
}

.message-websearch-keywords-text {
  @apply truncate;
}

.message-websearch-keywords-query {
  @apply text-sm text-gray-500;
}

.message-websearch-results {
  @apply flex flex-col gap-1 rounded-xl bg-neutral-100 py-3;
}

.message-websearch-results-header {
  @apply flex items-center gap-2 px-4 font-medium;
}

.message-results-list {
  @apply flex flex-col;
}

.message-result-item {
  @apply mx-2 flex flex-col gap-1 rounded-md p-2 transition-colors duration-200 hover:bg-neutral-200;
}

.message-result-title {
  @apply font-medium;
}

.message-result-description {
  @apply line-clamp-2 text-sm;
}

.message-toggle {
  @apply mt-1 flex justify-center;
}

.message-toggle-text {
  @apply cursor-pointer text-sm text-gray-500 transition-colors duration-200 hover:text-gray-700;
}
</style>
