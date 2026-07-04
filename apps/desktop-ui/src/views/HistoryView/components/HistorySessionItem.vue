<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { cn } from '../../../utils';
import { formatSessionTime, getSessionTitle } from '../../../utils/session-display';
import HistoryDeleteSessionDialog from './HistoryDeleteSessionDialog.vue';

const props = defineProps<{
  session: ChaptaleSessionListItem;
  isActive: boolean;
}>();

const emit = defineEmits<{
  select: [session: ChaptaleSessionListItem];
  delete: [sessionId: string];
}>();
</script>

<template>
  <div :class="cn('history-item', props.isActive && 'history-item-active')" role="listitem">
    <button class="history-item-select" type="button" @click="emit('select', props.session)">
      <span class="history-item-icon" aria-hidden="true">
        <span class="i-mingcute-chat-3-line" />
      </span>

      <span class="history-item-body">
        <span class="history-item-main">
          <span class="history-item-title">{{ getSessionTitle(props.session) }}</span>
          <span class="history-item-time">{{ formatSessionTime(props.session.updatedAt) }}</span>
        </span>
        <span class="history-item-preview">
          {{ props.session.lastMessagePreview || '暂无消息' }}
        </span>
      </span>

      <span class="history-item-meta">
        <span>{{ props.session.messageCount }}</span>
      </span>
      <span class="i-mingcute-right-line history-item-arrow" aria-hidden="true" />
    </button>

    <HistoryDeleteSessionDialog :session="props.session" @delete="emit('delete', $event)" />
  </div>
</template>

<style scoped lang="scss">
.history-item {
  @apply relative flex w-full items-center gap-2 border p-2 transition-all duration-150;

  border-color: transparent;
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.history-item:hover {
  background: var(--primary-hover);
}

.history-item-active {
  background: var(--secondary);
  border-color: var(--border-strong);
}

.history-item-select {
  @apply flex min-w-0 flex-1 items-center gap-3 p-1 text-left outline-none;
}

.history-item-select:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-item-icon {
  @apply flex-center size-10 shrink-0 border text-lg;

  background: var(--surface-muted);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--primary-solid);
}

.history-item-body {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.history-item-main {
  @apply flex min-w-0 items-center justify-between gap-4;
}

.history-item-title {
  @apply truncate text-sm font-semibold;
}

.history-item-time {
  @apply shrink-0 text-xs;

  color: var(--muted-foreground);
}

.history-item-preview {
  @apply truncate text-xs;

  color: var(--muted-foreground);
}

.history-item-meta {
  @apply flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs;

  background: var(--surface-muted);
  color: var(--muted-foreground);
}

.history-item-arrow {
  @apply shrink-0 transition-all duration-150;
}

.history-item:hover .history-item-arrow,
.history-item:focus-within .history-item-arrow {
  @apply translate-y-[-0.75rem];
}
</style>
