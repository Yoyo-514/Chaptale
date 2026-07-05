<script setup lang="ts">
import { computed } from 'vue';

import { formatToolName, formatUnknownToolPayload } from '../../utils/message/message-content';
import ToolMessageCard from './ToolMessageCard.vue';

const props = defineProps<{
  name: string;
  args: Record<string, unknown>;
}>();

const summary = computed(() => {
  if (props.name === 'websearch') {
    const keywords = props.args.keywords;
    return typeof keywords === 'string' ? `搜索：${keywords}` : '正在联网搜索';
  }

  return 'Agent 正在调用工具';
});

const details = computed(() => formatUnknownToolPayload(props.args));
</script>

<template>
  <ToolMessageCard
    :title="formatToolName(name)"
    :summary="summary"
    :details="details"
    :icon="name === 'websearch' ? 'i-mingcute-search-line' : 'i-mingcute-tool-line'"
    status="running"
  />
</template>
