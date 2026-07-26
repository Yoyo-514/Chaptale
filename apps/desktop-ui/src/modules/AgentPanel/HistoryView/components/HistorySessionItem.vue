<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { AppCheckbox } from '@/components/AppCheckbox';
import { SessionRenameDialog } from '@/features/sessions';
import { cn } from '@/utils';
import {
  formatSessionCost,
  formatSessionScope,
  formatSessionTime,
  formatTokenCount,
  getSessionTitle
} from '@/utils/session-display';

import HistoryDeleteSessionDialog from './HistoryDeleteSessionDialog.vue';

const props = defineProps<{
  session: ChaptaleSessionListItem;
  isActive: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  select: [session: ChaptaleSessionListItem];
  delete: [sessionId: string];
  rename: [sessionId: string, name: string];
  toggleSelect: [sessionId: string];
}>();

function handleMainClick() {
  if (props.isSelectionMode) {
    emit('toggleSelect', props.session.id);
    return;
  }

  emit('select', props.session);
}
</script>

<template>
  <div
    :class="cn('history-item', props.isActive && 'history-item-active', props.isSelected && 'history-item-selected')"
    role="listitem"
  >
    <AppCheckbox
      v-if="props.isSelectionMode"
      size="md"
      :model-value="props.isSelected"
      :aria-label="`选择 ${getSessionTitle(props.session)}`"
      @update:model-value="emit('toggleSelect', props.session.id)"
    />

    <button class="history-item-select" type="button" @click="handleMainClick">
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
        <span v-if="props.session.scope === 'workspace'" class="history-item-workspace" :title="props.session.cwd">
          <span class="i-mingcute-folder-line" aria-hidden="true" />
          <span>{{ props.session.cwd }}</span>
        </span>
        <span class="history-item-stats" aria-label="会话统计">
          <span>{{ formatSessionScope(props.session.scope) }}</span>
          <span>{{ props.session.messageCount }} 条</span>
          <span>{{ formatTokenCount(props.session.totalTokens) }} token</span>
          <span>{{ formatSessionCost(props.session.totalCost) }}</span>
        </span>
      </span>

      <span v-if="!props.isSelectionMode" class="i-mingcute-right-line history-item-arrow" aria-hidden="true" />
    </button>

    <SessionRenameDialog
      v-if="!props.isSelectionMode"
      :session="props.session"
      trigger-class="history-rename-button"
      @rename="(sessionId, name) => emit('rename', sessionId, name)"
    />

    <HistoryDeleteSessionDialog
      v-if="!props.isSelectionMode"
      :session="props.session"
      @delete="emit('delete', $event)"
    />
  </div>
</template>

<style scoped lang="scss">
.history-item {
  @apply relative flex w-full items-center gap-2 overflow-hidden border p-2 transition-all duration-150;

  border-color: transparent;
  border-radius: var(--radius-control);
  color: var(--foreground);
}

.history-item:hover {
  background: var(--surface-muted);
}

.history-item-active {
  background: var(--secondary);
  border-color: var(--border-strong);
}

.history-item-selected {
  background: var(--secondary);
  border-color: var(--primary-solid);
}

.history-item-select {
  @apply flex min-w-0 flex-1 items-center gap-3 p-1 pr-12 text-left outline-none;
}

.history-item-select:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-item-icon {
  @apply flex-center size-10 shrink-0 border text-lg;

  background: var(--surface-muted);
  border-radius: var(--radius-control);
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

.history-item-workspace {
  @apply flex min-w-0 items-center gap-1 text-[0.7rem];

  color: var(--muted-foreground);
}

.history-item-workspace > span:last-child {
  @apply truncate;
}

.history-item-stats {
  @apply flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem];

  color: var(--muted-foreground);
}

.history-item-stats span {
  @apply rounded-full px-2 py-0.5;

  background: var(--surface-acrylic-subtle);
}

.history-item-arrow {
  @apply absolute right-3 top-3 shrink-0 text-xl transition-all duration-200 ease-out;

  color: var(--muted-foreground);
  opacity: 0;
  transform: translateX(0.35rem) scale(0.9);
}

.history-item:hover .history-item-arrow,
.history-item:focus-within .history-item-arrow {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.history-item :deep(.history-rename-button) {
  @apply absolute bottom-1.5 right-9 opacity-0 transition-all duration-200 ease-out;

  background: var(--surface-acrylic-strong);
  pointer-events: none;
  transform: translate(0.25rem, 0.25rem) scale(0.92);
}

.history-item :deep(.history-rename-button:hover),
.history-item :deep(.history-rename-button:focus-visible) {
  background: var(--primary-hover);
}

.history-item:hover :deep(.history-delete-button),
.history-item:focus-within :deep(.history-delete-button),
.history-item:hover :deep(.history-rename-button),
.history-item:focus-within :deep(.history-rename-button) {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, 0) scale(1);
}
</style>
