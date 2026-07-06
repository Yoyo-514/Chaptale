<script setup lang="ts">
import { computed } from 'vue';

import { formatToolName, formatUnknownToolPayload } from '../../utils/message/message-content';
import ToolMessageCard from './ToolMessageCard.vue';

const props = defineProps<{
  name: string;
  args: Record<string, unknown>;
}>();

const summary = computed(() => {
  if (props.name === 'web_search') {
    const query = formatSearchQuery(props.args);
    return query ? `搜索：${query}` : '正在联网搜索';
  }

  if (props.name === 'fetch_content') {
    const target = formatUrlTarget(props.args);
    return target ? `读取：${target}` : '正在读取网页内容';
  }

  if (props.name === 'get_search_content') {
    const responseId = props.args.responseId;
    return typeof responseId === 'string' ? `取回搜索内容：${responseId}` : '正在取回搜索内容';
  }

  return 'Agent 正在调用工具';
});

const details = computed(() => formatUnknownToolPayload(props.args));
const icon = computed(() => {
  if (props.name === 'web_search') return 'i-mingcute-search-line';
  if (props.name === 'fetch_content' || props.name === 'get_search_content') return 'i-mingcute-link-line';
  return 'i-mingcute-tool-line';
});

function formatSearchQuery(args: Record<string, unknown>) {
  if (typeof args.query === 'string') {
    return args.query;
  }

  if (Array.isArray(args.queries)) {
    return args.queries.filter((item): item is string => typeof item === 'string').join(' / ');
  }

  return '';
}

function formatUrlTarget(args: Record<string, unknown>) {
  if (typeof args.url === 'string') {
    return args.url;
  }

  if (Array.isArray(args.urls)) {
    return args.urls.filter((item): item is string => typeof item === 'string').join(' / ');
  }

  return '';
}
</script>

<template>
  <ToolMessageCard :title="formatToolName(name)" :summary="summary" :details="details" :icon="icon" status="running" />
</template>
