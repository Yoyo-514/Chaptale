<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppCollapsible } from '@/components/AppCollapsible';
import { AppImagePreview } from '@/components/AppImagePreview';
import { formatTokenCount } from '@/utils/session-display';
import type { ChatMessage, ChatToolCallContent } from '@chaptale/shared';
import type { ChatDisplayMessage, ChatSearchMatch } from '../../types';
import { toInlineImageItems } from '../../utils/message/inline-images';
import { formatToolName, getAssistantToolCalls, getToolResultImages } from '../../utils/message/message-content';
import MessageCompactionNotice from './MessageCompactionNotice.vue';
import ToolExecutionItem from './ToolExecutionItem.vue';

type ToolExecution = {
  key: string;
  call?: ChatToolCallContent;
  result?: Extract<ChatMessage, { role: 'toolResult' }>;
  resultDisplayId?: string;
  sourceIds: string[];
};

const props = defineProps<{
  messages: ChatDisplayMessage[];
  isBusy?: boolean;
  searchHit?: ChatSearchMatch;
}>();

const open = ref(false);
const executions = computed<ToolExecution[]>(() => {
  const items: ToolExecution[] = [];
  const byCallId = new Map<string, ToolExecution>();

  for (const displayMessage of props.messages) {
    const message = displayMessage.message;

    if (message.role === 'assistant') {
      for (const call of getAssistantToolCalls(message)) {
        const execution: ToolExecution = {
          key: call.id,
          call,
          sourceIds: [displayMessage.id]
        };
        items.push(execution);
        byCallId.set(call.id, execution);
      }
      continue;
    }

    if (message.role === 'toolResult') {
      const execution = byCallId.get(message.toolCallId);

      if (execution) {
        execution.result = message;
        execution.resultDisplayId = displayMessage.id;
        execution.sourceIds.push(displayMessage.id);
      } else {
        items.push({
          key: `result-${message.toolCallId}-${displayMessage.id}`,
          result: message,
          resultDisplayId: displayMessage.id,
          sourceIds: [displayMessage.id]
        });
      }
    }
  }

  return items;
});
const containsSearchHit = computed(() =>
  executions.value.some(execution => {
    if (props.searchHit?.toolTarget) {
      return execution.key === props.searchHit.toolTarget.callId;
    }

    return execution.sourceIds.some(id => id === props.searchHit?.id || id === `${props.searchHit?.id}-tools`);
  })
);
const completedCount = computed(() => executions.value.filter(execution => execution.result).length);
const toolActivityTitle = computed(() => {
  const names = [
    ...new Set(
      executions.value.map(execution => formatToolName(execution.call?.name ?? execution.result?.toolName ?? 'unknown'))
    )
  ];
  const visibleNames = names.slice(0, 3).join('、');

  if (names.length <= 3) {
    return visibleNames || '工具活动';
  }

  return `${visibleNames} 等 ${names.length} 种`;
});
// 纯工具调用的 assistant 消息不会出现在普通消息行里，它的 token 用量在这里汇总展示。
const totalTokens = computed(() =>
  props.messages.reduce(
    (sum, displayMessage) =>
      displayMessage.message.role === 'assistant' ? sum + (displayMessage.message.usage?.totalTokens ?? 0) : sum,
    0
  )
);
const summary = computed(() => {
  const total = executions.value.length;
  const parts = [`${total} 次调用`];

  if (completedCount.value === total) {
    parts.push('已完成');
  } else {
    parts.push(props.isBusy ? `${completedCount.value} 次已完成` : '部分已中断');
  }

  if (totalTokens.value > 0) {
    parts.push(`${formatTokenCount(totalTokens.value)} tokens`);
  }

  return parts.join(' · ');
});
// 工具结果里的图片提升到分组外常驻展示，避免被两层折叠埋住。
const resultImages = computed(() =>
  executions.value.flatMap(execution =>
    execution.result
      ? toInlineImageItems(
          getToolResultImages(execution.result),
          execution.resultDisplayId ?? execution.result.toolCallId
        )
      : []
  )
);
const compaction = computed(() => props.messages.find(message => message.compactionBefore)?.compactionBefore);

watch(
  containsSearchHit,
  value => {
    if (value) open.value = true;
  },
  { immediate: true }
);
</script>

<template>
  <div class="tool-message-group-wrapper">
    <MessageCompactionNotice v-if="compaction" :summary="compaction.summary" :tokens-before="compaction.tokensBefore" />

    <AppCollapsible
      v-model="open"
      class="tool-message-group"
      trigger-class="tool-message-group-trigger"
      content-class="tool-message-group-content"
      :unmount-on-hide="false"
    >
      <template #trigger="{ open: isOpen, triggerClass }">
        <button :class="triggerClass" type="button">
          <span class="i-mingcute-tool-line tool-message-group-icon" aria-hidden="true" />
          <span class="tool-message-group-title" :title="toolActivityTitle">{{ toolActivityTitle }}</span>
          <span class="tool-message-group-summary">{{ summary }}</span>
          <span :class="['i-mingcute-down-line tool-message-group-chevron', isOpen && 'is-open']" aria-hidden="true" />
        </button>
      </template>

      <div class="tool-message-group-list">
        <ToolExecutionItem
          v-for="execution in executions"
          :key="execution.key"
          :call="execution.call"
          :result="execution.result"
          :is-busy="props.isBusy"
          :search-section="
            execution.key === props.searchHit?.toolTarget?.callId ? props.searchHit.toolTarget.section : undefined
          "
        />
      </div>
    </AppCollapsible>

    <div v-if="resultImages.length" class="tool-message-group-images">
      <AppImagePreview variant="large" :items="resultImages" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-message-group-wrapper {
  @apply flex w-full flex-col gap-2;
}

.tool-message-group {
  @apply w-full;
}

.tool-message-group-images {
  @apply w-full;
}

.tool-message-group :deep(.tool-message-group-trigger) {
  @apply flex w-full items-center gap-2 px-3 py-2 text-left;
}

.tool-message-group-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.tool-message-group-title {
  @apply min-w-0 flex-1 text-xs font-medium;
}

.tool-message-group-summary {
  @apply shrink-0 text-[11px];

  color: var(--muted-foreground);
}

.tool-message-group-chevron {
  @apply shrink-0 text-sm transition-transform duration-150;

  color: var(--muted-foreground);
}

.tool-message-group-chevron.is-open {
  transform: rotate(180deg);
}

.tool-message-group :deep(.tool-message-group-content) {
  @apply p-0;
}

.tool-message-group-list {
  @apply flex flex-col gap-1 border-t p-2;

  border-color: var(--border-subtle);
}
</style>
