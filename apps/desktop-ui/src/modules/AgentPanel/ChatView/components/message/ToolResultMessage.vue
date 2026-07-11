<script setup lang="ts">
import { computed } from 'vue';

import { formatMaybeJson, formatToolName } from '../../utils/message/message-content';
import MessageWebsearchResults from './MessageWebsearchResults.vue';
import ToolMessageSection from './ToolMessageSection.vue';

const props = defineProps<{
  name: string;
  content: string;
  imageCount?: number;
  isError?: boolean;
  searchOpen?: boolean;
}>();

const isWebSearch = computed(() => props.name === 'web_search');
const formattedContent = computed(() => formatMaybeJson(props.content));
const icon = computed(() => {
  if (props.isError) return 'i-mingcute-close-circle-line';
  if (props.name === 'fetch_content' || props.name === 'get_search_content') return 'i-mingcute-link-line';
  return 'i-mingcute-check-circle-line';
});
const summary = computed(() => {
  if (props.isError) {
    return '工具执行失败，展开查看错误信息';
  }

  if (!props.content) {
    return props.imageCount ? `返回了 ${props.imageCount} 张图片，见下方大图` : '工具没有返回内容';
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
  <ToolMessageSection
    v-if="isWebSearch && !props.isError"
    :title="`结果 · ${formatToolName(name)}`"
    :summary="summary"
    :icon="icon"
    :search-open="props.searchOpen"
    :status="props.isError ? 'error' : 'done'"
  >
    <MessageWebsearchResults :content="content" />
  </ToolMessageSection>
  <ToolMessageSection
    v-else
    :title="`结果 · ${formatToolName(name)}`"
    :summary="summary"
    :details="formattedContent"
    :icon="icon"
    :search-open="props.searchOpen"
    :status="props.isError ? 'error' : 'done'"
  />
</template>
