<script setup lang="ts">
import { computed } from 'vue';

import { formatMaybeJson, formatToolName } from '../../utils/message/message-content';
import MessageWebsearchResults from './MessageWebsearchResults.vue';
import ToolMessageCard from './ToolMessageCard.vue';

const props = defineProps<{
  name: string;
  content: string;
}>();

const isWebSearch = computed(() => props.name === 'web_search');
const formattedContent = computed(() => formatMaybeJson(props.content));
const icon = computed(() => {
  if (props.name === 'fetch_content' || props.name === 'get_search_content') return 'i-mingcute-link-line';
  return 'i-mingcute-check-circle-line';
});
const summary = computed(() => {
  if (!props.content) {
    return '工具没有返回内容';
  }

  if (props.name === 'fetch_content') {
    return '网页内容已读取，展开查看提取结果';
  }

  if (props.name === 'get_search_content') {
    return '已取回之前保存的搜索/网页内容';
  }

  return formattedContent.value.split('\n').slice(0, 2).join(' ').slice(0, 160);
});
</script>

<template>
  <MessageWebsearchResults v-if="isWebSearch" :content="content" />
  <ToolMessageCard
    v-else
    :title="`${formatToolName(name)} 结果`"
    :summary="summary"
    :details="formattedContent"
    :icon="icon"
    status="done"
  />
</template>
