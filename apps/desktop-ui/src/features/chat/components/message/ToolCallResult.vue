<script setup lang="ts">
import { computed } from 'vue';

import { formatMaybeJson, formatToolName } from '../../utils/message/message-content';
import MessageWebsearchResults from './MessageWebsearchResults.vue';
import ToolCallSection from './ToolCallSection.vue';

const props = defineProps<{
  name: string;
  content: string;
  /** 工具结构化载荷；web_search 的 {results: [...]} 优先于文本解析。 */
  details?: unknown;
  imageCount?: number;
  isError?: boolean;
  /** 中断补位：调用发出去了但没跑完，不是工具自己出的错。 */
  interrupted?: boolean;
  searchOpen?: boolean;
}>();

const isWebSearch = computed(() => props.name === 'web_search');
const webSearchResults = computed(() => extractWebSearchResults(props.details));
const formattedContent = computed(() => formatMaybeJson(props.content));
const sectionStatus = computed(() => {
  if (props.interrupted) return 'interrupted' as const;

  return props.isError ? ('error' as const) : ('done' as const);
});
const icon = computed(() => {
  // 与 subagent 卡片的「已取消」同一个图标：中断在别处已经有了视觉语言。
  if (props.interrupted) return 'i-mingcute-forbid-circle-line';
  if (props.isError) return 'i-mingcute-close-circle-line';
  if (props.name === 'fetch_content' || props.name === 'get_search_content') return 'i-mingcute-link-line';
  return 'i-mingcute-check-circle-line';
});
const summary = computed(() => {
  if (props.interrupted) {
    return '本次运行已中断，这一步没有执行';
  }

  if (props.isError) {
    return '工具执行失败，展开查看错误信息';
  }

  if (props.name === 'web_search' && webSearchResults.value.length === 0 && !props.content) {
    return '联网搜索已关闭或无结果';
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

/** 只接受 [{title,url,snippet}] 形状；形状不符时返回空表并降级文本渲染。 */
function extractWebSearchResults(details: unknown) {
  if (!details || typeof details !== 'object') {
    return [];
  }

  const results = (details as { results?: unknown }).results;

  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter(
    (item): item is { title: string; url: string; snippet: string } =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as { title?: unknown }).title === 'string' &&
      typeof (item as { url?: unknown }).url === 'string'
  );
}
</script>

<template>
  <ToolCallSection
    v-if="isWebSearch && !props.isError"
    :title="`结果 · ${formatToolName(name)}`"
    :summary="summary"
    :icon="icon"
    :search-open="props.searchOpen"
    :status="sectionStatus"
  >
    <MessageWebsearchResults :content="content" :results="webSearchResults" />
  </ToolCallSection>
  <ToolCallSection
    v-else
    :title="`结果 · ${formatToolName(name)}`"
    :summary="summary"
    :details="formattedContent"
    :icon="icon"
    :search-open="props.searchOpen"
    :status="sectionStatus"
  />
</template>
