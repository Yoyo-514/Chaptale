<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { computed, ref } from 'vue';

import type { ChatMessage, WebsearchResult } from '@chaptale/shared';
import { cn } from '@/lib/utils';

import 'github-markdown-css/github-markdown.css';
import styles from './MessageItem.module.scss';

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
  <div :class="cn(styles.messageContainer, isUserMessage && styles.messageContainerUser)">
    <p v-if="message.type === 'user'" :class="styles.userMessage">{{ message.payload.content }}</p>

    <div v-else-if="message.type === 'assistant'" class="markdown-body" v-html="assistantHtml" />

    <div
      v-else-if="message.type === 'tool_call' && message.payload.name === 'websearch'"
      :class="styles.websearchKeywords"
    >
      <span :class="styles.websearchKeywordsIcon" aria-hidden="true">⌕</span>
      <span :class="styles.websearchKeywordsText">
        正在搜索：
        <span :class="styles.websearchKeywordsQuery">{{ message.payload.args.keywords }}</span>
      </span>
    </div>

    <div
      v-else-if="message.type === 'tool_result' && message.payload.name === 'websearch'"
      :class="styles.websearchResults"
    >
      <p :class="styles.websearchResultsHeader">
        <span aria-hidden="true">◎</span>
        已搜索 {{ websearchResults.length }} 条结果
      </p>

      <div :class="styles.resultsList">
        <a
          v-for="(result, index) in displayedResults"
          :key="index"
          :class="styles.resultItem"
          :href="result.link"
          target="_blank"
          rel="noreferrer"
        >
          <p :class="styles.resultTitle">{{ result.title }}</p>
          <p :class="styles.resultDescription">{{ result.description }}</p>
        </a>
      </div>

      <div :class="styles.toggleButton">
        <span :class="styles.toggleButtonText" @click="showAll = !showAll">
          {{ showAll ? '收起' : '展开所有' }}
        </span>
      </div>
    </div>
  </div>
</template>
