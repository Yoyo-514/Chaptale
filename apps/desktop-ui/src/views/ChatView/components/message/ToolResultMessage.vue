<script setup lang="ts">
import { computed } from 'vue';

import { formatMaybeJson, formatToolName } from '../../utils/message/message-content';
import MessageWebsearchResults from './MessageWebsearchResults.vue';
import ToolMessageCard from './ToolMessageCard.vue';

const props = defineProps<{
  name: string;
  content: string;
}>();

const isWebsearch = computed(() => props.name === 'websearch');
const formattedContent = computed(() => formatMaybeJson(props.content));
const summary = computed(() => {
  if (!props.content) {
    return '工具没有返回内容';
  }

  return formattedContent.value.split('\n').slice(0, 2).join(' ').slice(0, 160);
});
</script>

<template>
  <MessageWebsearchResults v-if="isWebsearch" :content="content" />
  <ToolMessageCard
    v-else
    :title="`${formatToolName(name)} 结果`"
    :summary="summary"
    :details="formattedContent"
    icon="i-mingcute-check-circle-line"
    status="done"
  />
</template>
