<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { computed } from 'vue';

import { cn } from '@/utils';
import type { ChatMessage } from '@chaptale/shared';
import MessageWebsearchResults from './MessageWebsearchResults.vue';

const props = defineProps<{
  message: ChatMessage;
}>();

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const isUserMessage = computed(() => props.message.type === 'user');
const assistantHtml = computed(() => {
  if (props.message.type !== 'assistant') return '';

  return markdown.render(props.message.payload.content);
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
      <span class="i-mingcute-search-line message-websearch-keywords-icon" aria-hidden="true" />
      <span class="message-websearch-keywords-text">
        正在搜索：
        <span class="message-websearch-keywords-query">{{ message.payload.args.keywords }}</span>
      </span>
    </div>

    <MessageWebsearchResults
      v-else-if="message.type === 'tool_result' && message.payload.name === 'websearch'"
      :content="message.payload.content"
    />
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
  @apply max-w-[80%] rounded-full bg-primary px-4 py-1.5 text-primary-foreground shadow-inset-highlight;
}

.message-websearch-keywords {
  @apply flex max-w-full items-center gap-2 truncate rounded-full border border-border-subtle bg-surface-acrylic px-4 py-1.5 text-foreground shadow-inset-highlight;
}

.message-websearch-keywords-icon {
  @apply shrink-0 text-primary-solid;
}

.message-websearch-keywords-text {
  @apply truncate;
}

.message-websearch-keywords-query {
  @apply text-sm text-muted-foreground;
}
</style>
