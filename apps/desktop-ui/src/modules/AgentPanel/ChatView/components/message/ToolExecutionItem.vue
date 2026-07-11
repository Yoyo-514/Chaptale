<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ChatMessage, ChatToolCallContent } from '@chaptale/shared';
import { AppCollapsible } from '@/components/AppCollapsible';
import { formatToolName, getTextBlocks, getToolResultImages } from '../../utils/message/message-content';
import ToolCallMessage from './ToolCallMessage.vue';
import ToolResultMessage from './ToolResultMessage.vue';

const props = defineProps<{
  call?: ChatToolCallContent;
  result?: Extract<ChatMessage, { role: 'toolResult' }>;
  isBusy?: boolean;
  searchSection?: 'call' | 'result';
}>();

const open = ref(false);

watch(
  () => props.searchSection,
  section => {
    if (section) open.value = true;
  },
  { immediate: true }
);
const name = computed(() => props.call?.name ?? props.result?.toolName ?? 'unknown');
const status = computed(() => {
  if (props.result) {
    return props.result.isError ? '失败' : '已完成';
  }

  return props.isBusy ? '执行中' : '已中断';
});
const target = computed(() => formatToolTarget(props.call?.arguments));
const title = computed(() => [formatToolName(name.value), target.value].filter(Boolean).join(' · '));
const resultContent = computed(() =>
  props.result
    ? getTextBlocks(props.result.content)
        .map(block => block.text)
        .join('\n')
    : ''
);
const resultImageCount = computed(() => (props.result ? getToolResultImages(props.result).length : 0));

function formatToolTarget(args?: Record<string, unknown>) {
  if (!args) return '';

  for (const key of ['path', 'filePath', 'url', 'query', 'command']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 120);
    }
  }

  return '';
}
</script>

<template>
  <AppCollapsible
    v-model="open"
    class="tool-execution"
    trigger-class="tool-execution-trigger"
    content-class="tool-execution-content"
    :unmount-on-hide="false"
  >
    <template #trigger="{ open: isOpen, triggerClass }">
      <button :class="triggerClass" type="button">
        <span class="i-mingcute-tool-line tool-execution-icon" aria-hidden="true" />
        <span class="tool-execution-title">{{ title }}</span>
        <span :class="['tool-execution-status', props.result?.isError && 'is-error']">{{ status }}</span>
        <span :class="['i-mingcute-down-line tool-execution-chevron', isOpen && 'is-open']" aria-hidden="true" />
      </button>
    </template>

    <div class="tool-execution-sections">
      <ToolCallMessage
        v-if="props.call"
        :name="props.call.name"
        :args="props.call.arguments"
        :search-open="props.searchSection === 'call'"
      />
      <div v-else class="tool-execution-missing">缺少对应的工具调用参数</div>

      <ToolResultMessage
        v-if="props.result"
        :name="props.result.toolName"
        :content="resultContent"
        :image-count="resultImageCount"
        :is-error="props.result.isError"
        :search-open="props.searchSection === 'result'"
      />
      <div v-else class="tool-execution-pending">
        {{ props.isBusy ? '等待工具返回结果' : '工具调用已中断，没有返回结果' }}
      </div>
    </div>
  </AppCollapsible>
</template>

<style scoped lang="scss">
.tool-execution {
  @apply w-full;
}

.tool-execution :deep(.tool-execution-trigger) {
  @apply flex w-full items-center gap-2 px-3 py-2 text-left;
}

.tool-execution-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.tool-execution-title {
  @apply min-w-0 flex-1 truncate text-xs font-medium;
}

.tool-execution-status {
  @apply shrink-0 text-[11px];

  color: var(--muted-foreground);
}

.tool-execution-status.is-error {
  color: var(--destructive);
}

.tool-execution-chevron {
  @apply shrink-0 text-sm transition-transform duration-150;

  color: var(--muted-foreground);
}

.tool-execution-chevron.is-open {
  transform: rotate(180deg);
}

.tool-execution :deep(.tool-execution-content) {
  @apply p-0;
}

.tool-execution-sections {
  @apply border-t px-3 py-1;

  border-color: var(--border-subtle);
}

.tool-execution-missing,
.tool-execution-pending {
  @apply px-2 py-2 text-xs;

  color: var(--muted-foreground);
}
</style>
