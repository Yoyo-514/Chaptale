<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ChatMessage, ChatToolCall } from '@chaptale/shared';

import { AppCollapsible } from '@/components/AppCollapsible';
import { AppImagePreview } from '@/components/AppImagePreview';
import { formatTokenCount } from '@/utils/session-display';

import type { ChatDisplayMessage, ChatSearchMatch } from '../../types';
import { toInlineImageItems } from '../../utils/message/inline-images';
import { formatToolName, getAssistantToolCalls, getToolResultImages } from '../../utils/message/message-content';
import MessageCompactionNotice from './MessageCompactionNotice.vue';
import ToolCallItem from './ToolCallItem.vue';

type ToolExecution = {
  key: string;
  call?: ChatToolCall;
  result?: Extract<ChatMessage, { role: 'tool' }>;
  resultDisplayId?: string;
  sourceIds: string[];
};

const props = defineProps<{
  messages: ChatDisplayMessage[];
  isBusy?: boolean;
  searchHit?: ChatSearchMatch;
}>();

const open = ref(false);
// 按 toolCallId 将分散的 assistant 调用与 toolResult 配对；孤立结果仍保留，便于展示损坏或旧会话。
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

    if (message.role === 'tool') {
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
  <div class="tool-call-group-wrapper">
    <MessageCompactionNotice v-if="compaction" :summary="compaction.summary" :tokens-before="compaction.tokensBefore" />

    <AppCollapsible
      v-model="open"
      class="tool-call-group"
      trigger-class="tool-call-group-trigger"
      content-class="tool-call-group-content"
      :unmount-on-hide="false"
    >
      <template #trigger="{ open: isOpen, triggerClass }">
        <button :class="triggerClass" type="button">
          <span class="i-mingcute-tool-line tool-call-group-icon" aria-hidden="true" />
          <span class="tool-call-group-title" :title="toolActivityTitle">{{ toolActivityTitle }}</span>
          <span class="tool-call-group-summary">{{ summary }}</span>
          <span :class="['i-mingcute-down-line tool-call-group-chevron', isOpen && 'is-open']" aria-hidden="true" />
        </button>
      </template>

      <div class="tool-call-group-list">
        <ToolCallItem
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

    <div v-if="resultImages.length" class="tool-call-group-images">
      <AppImagePreview variant="large" :items="resultImages" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-call-group-wrapper {
  @apply flex w-full flex-col gap-2;
}

.tool-call-group {
  @apply w-full;
}

.tool-call-group-images {
  @apply w-full;
}

.tool-call-group :deep(.tool-call-group-trigger) {
  @apply flex w-full items-center gap-2 px-3 py-2 text-left;
}

.tool-call-group-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.tool-call-group-title {
  @apply min-w-0 flex-1 text-xs font-medium;
}

.tool-call-group-summary {
  @apply shrink-0 text-[11px];

  color: var(--muted-foreground);
}

.tool-call-group-chevron {
  @apply shrink-0 text-sm transition-transform duration-150;

  color: var(--muted-foreground);
}

.tool-call-group-chevron.is-open {
  transform: rotate(180deg);
}

.tool-call-group :deep(.tool-call-group-content) {
  @apply p-0;
}

.tool-call-group-list {
  @apply flex flex-col gap-1 border-t p-2;

  border-color: var(--border-subtle);
}
</style>
