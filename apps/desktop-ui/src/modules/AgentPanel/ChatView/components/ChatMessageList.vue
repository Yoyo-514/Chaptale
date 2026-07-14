<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ChatDisplayMessage, ChatSearchMatch } from '../types';
import { getAssistantToolCalls } from '../utils/message/message-content';
import MessageItem from './message/MessageItem.vue';
import ToolCallGroup from './message/ToolCallGroup.vue';

const props = defineProps<{
  messages: ChatDisplayMessage[];
  editingMessageId?: string;
  isBusy?: boolean;
  searchHit?: ChatSearchMatch;
}>();

const emit = defineEmits<{
  editUser: [messageId: string];
  saveUser: [messageId: string, content: string];
  cancelEdit: [];
  regenerateAssistant: [messageId: string];
  switchBranch: [leafId: string];
}>();

type ChatMessageRow =
  | { type: 'message'; key: string; message: ChatDisplayMessage }
  | { type: 'tool-group'; key: string; messages: ChatDisplayMessage[] };

const scrollElementRef = ref<HTMLElement | null>(null);
let scrollToBottomFrameId = 0;

const rows = computed<ChatMessageRow[]>(() => {
  const result: ChatMessageRow[] = [];
  let toolMessages: ChatDisplayMessage[] = [];

  function flushToolMessages() {
    if (toolMessages.length === 0) {
      return;
    }

    result.push({ type: 'tool-group', key: `tools-${toolMessages[0]?.id}`, messages: toolMessages });
    toolMessages = [];
  }

  for (const displayMessage of props.messages) {
    const message = displayMessage.message;

    if (message.role === 'toolResult') {
      toolMessages.push(displayMessage);
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls = getAssistantToolCalls(message);

      if (toolCalls.length > 0) {
        const nonToolContent = message.content.filter(block => block.type !== 'toolCall');

        if (nonToolContent.length > 0 || message.errorMessage || message.retry) {
          flushToolMessages();
          result.push({
            type: 'message',
            key: displayMessage.id,
            message: { ...displayMessage, message: { ...message, content: nonToolContent } }
          });
        }

        toolMessages.push({
          ...displayMessage,
          id: nonToolContent.length > 0 ? `${displayMessage.id}-tools` : displayMessage.id,
          compactionBefore: nonToolContent.length > 0 ? undefined : displayMessage.compactionBefore,
          message: {
            ...message,
            content: toolCalls,
            errorMessage: undefined,
            retry: undefined,
            // 拆分出文本行时用量归文本行展示，工具分组只统计纯工具消息，避免重复计入。
            usage: nonToolContent.length > 0 ? undefined : message.usage
          }
        });
        continue;
      }
    }

    flushToolMessages();
    result.push({ type: 'message', key: displayMessage.id, message: displayMessage });
  }

  flushToolMessages();
  return result;
});

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollElementRef.value,
    estimateSize: () => 112,
    overscan: 10,
    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: 32,
    getItemKey: (index: number) => rows.value[index]?.key ?? index
  }))
);

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const visibleVirtualItems = computed(() => virtualItems.value.filter(virtualItem => rows.value[virtualItem.index]));
const totalSize = computed(() => virtualizer.value.getTotalSize());
const firstMessageId = computed(() => props.messages[0]?.id ?? '');

function scheduleScrollToBottom() {
  if (scrollToBottomFrameId) {
    return;
  }

  scrollToBottomFrameId = requestAnimationFrame(() => {
    scrollToBottomFrameId = 0;

    if (rows.value.length === 0) {
      return;
    }

    virtualizer.value.scrollToIndex(rows.value.length - 1, { align: 'end' });
  });
}

async function scrollToBottom() {
  await nextTick();
  scheduleScrollToBottom();
}

async function scrollToIndex(index: number) {
  await nextTick();
  const messageId = props.messages[index]?.id;
  const rowIndex = messageId
    ? rows.value.findIndex(row =>
        row.type === 'message' ? row.message.id === messageId : row.messages.some(message => message.id === messageId)
      )
    : -1;

  if (rowIndex >= 0) {
    virtualizer.value.scrollToIndex(rowIndex, { align: 'center' });
  }
}

function getMessageRow(index: number) {
  const row = rows.value[index];
  return row?.type === 'message' ? row : undefined;
}

function getToolGroupRow(index: number) {
  const row = rows.value[index];
  return row?.type === 'tool-group' ? row : undefined;
}

function measureElement(element: unknown) {
  virtualizer.value.measureElement(element instanceof Element ? element : null);
}

onMounted(() => {
  void scrollToBottom();
});

onBeforeUnmount(() => {
  if (scrollToBottomFrameId) {
    cancelAnimationFrame(scrollToBottomFrameId);
    scrollToBottomFrameId = 0;
  }
});

watch(
  firstMessageId,
  async () => {
    await scrollToBottom();
  },
  { flush: 'post' }
);

defineExpose({ scrollToBottom, scrollToIndex });
</script>

<template>
  <div ref="scrollElementRef" class="chat-message-list-scroll">
    <div class="chat-message-list-spacer" :style="{ height: `${totalSize}px` }">
      <div
        v-for="virtualItem in visibleVirtualItems"
        :key="String(virtualItem.key)"
        :ref="measureElement"
        class="chat-message-list-row"
        :data-index="virtualItem.index"
        :style="{ transform: `translateY(${virtualItem.start}px)` }"
      >
        <MessageItem
          v-if="getMessageRow(virtualItem.index)"
          :display-message="getMessageRow(virtualItem.index)!.message"
          :is-editing="props.editingMessageId === getMessageRow(virtualItem.index)!.message.id"
          :is-busy="props.isBusy"
          :is-search-hit="
            Boolean(props.searchHit) && props.searchHit?.id === getMessageRow(virtualItem.index)!.message.id
          "
          @edit-user="emit('editUser', $event)"
          @save-user="(messageId, content) => emit('saveUser', messageId, content)"
          @cancel-edit="emit('cancelEdit')"
          @regenerate-assistant="emit('regenerateAssistant', $event)"
          @switch-branch="emit('switchBranch', $event)"
        />
        <ToolCallGroup
          v-else-if="getToolGroupRow(virtualItem.index)"
          :messages="getToolGroupRow(virtualItem.index)!.messages"
          :is-busy="props.isBusy"
          :search-hit="props.searchHit"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-message-list-scroll {
  @apply min-h-0 flex-1 overflow-y-auto px-4 pb-6 leading-relaxed;
}

.chat-message-list-spacer {
  @apply relative mx-auto w-full md:w-3xl;
}

.chat-message-list-row {
  @apply absolute left-0 top-0 w-full py-2;
}
</style>
