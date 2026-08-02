<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import HistorySessionItem from './HistorySessionItem.vue';

const props = defineProps<{
  sessions: ChaptaleSessionListItem[];
  currentSessionId: string;
  totalSessionCount: number;
  isLoading: boolean;
  error?: string;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
}>();

const emit = defineEmits<{
  select: [session: ChaptaleSessionListItem];
  delete: [sessionId: string];
  rename: [sessionId: string, name: string];
  toggleSelect: [sessionId: string];
}>();
</script>

<template>
  <div v-if="props.error" class="history-error">
    {{ props.error }}
  </div>

  <div v-else-if="props.isLoading" class="history-empty">
    <span class="i-mingcute-loading-line animate-spin" aria-hidden="true" />
    <span>正在读取历史记录...</span>
  </div>

  <div v-else-if="props.totalSessionCount === 0" class="history-empty">
    <span class="i-mingcute-inbox-2-line" aria-hidden="true" />
    <span>还没有会话，点击右上角加号开始新的创作。</span>
  </div>

  <div v-else-if="props.sessions.length === 0" class="history-empty">
    <span class="i-mingcute-search-line" aria-hidden="true" />
    <span>没有匹配的历史记录。</span>
  </div>

  <div v-else class="history-list" role="list">
    <HistorySessionItem
      v-for="session in props.sessions"
      :key="session.id"
      :session="session"
      :is-active="session.id === props.currentSessionId"
      :is-selection-mode="props.isSelectionMode"
      :is-selected="props.selectedIds.has(session.id)"
      @select="emit('select', $event)"
      @delete="emit('delete', $event)"
      @rename="(sessionId, name) => emit('rename', sessionId, name)"
      @toggle-select="emit('toggleSelect', $event)"
    />
  </div>
</template>

<style scoped lang="scss">
.history-error,
.history-empty,
.history-list {
  @apply mx-auto w-full max-w-4xl;
}

.history-error,
.history-empty {
  @apply mt-3 flex items-center justify-center gap-2 rounded-lg border p-4 text-center text-xs;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.history-error {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.history-list {
  @apply mt-2 flex flex-col gap-1;
}
</style>
