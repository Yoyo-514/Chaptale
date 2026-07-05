<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ChatDisplayMessage } from '../types';
import MessageItem from './message/MessageItem.vue';

const props = defineProps<{
  messages: ChatDisplayMessage[];
  editingMessageId?: string;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  editUser: [messageId: string];
  saveUser: [messageId: string, content: string];
  cancelEdit: [];
  regenerateAssistant: [messageId: string];
  switchBranch: [leafId: string];
}>();

const scrollElementRef = ref<HTMLElement | null>(null);
let scrollToBottomFrameId = 0;

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.messages.length,
    getScrollElement: () => scrollElementRef.value,
    estimateSize: () => 112,
    overscan: 10,
    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: 32,
    getItemKey: (index: number) => props.messages[index]?.id ?? index
  }))
);

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const visibleVirtualItems = computed(() => virtualItems.value.filter(virtualItem => props.messages[virtualItem.index]));
const totalSize = computed(() => virtualizer.value.getTotalSize());
const firstMessageId = computed(() => props.messages[0]?.id ?? '');

function scheduleScrollToBottom() {
  if (scrollToBottomFrameId) {
    return;
  }

  scrollToBottomFrameId = requestAnimationFrame(() => {
    scrollToBottomFrameId = 0;

    if (props.messages.length === 0) {
      return;
    }

    virtualizer.value.scrollToIndex(props.messages.length - 1, { align: 'end' });
  });
}

async function scrollToBottom() {
  await nextTick();
  scheduleScrollToBottom();
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

defineExpose({ scrollToBottom });
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
          :display-message="props.messages[virtualItem.index]"
          :is-editing="props.editingMessageId === props.messages[virtualItem.index].id"
          :is-busy="props.isBusy"
          @edit-user="emit('editUser', $event)"
          @save-user="(messageId, content) => emit('saveUser', messageId, content)"
          @cancel-edit="emit('cancelEdit')"
          @regenerate-assistant="emit('regenerateAssistant', $event)"
          @switch-branch="emit('switchBranch', $event)"
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
