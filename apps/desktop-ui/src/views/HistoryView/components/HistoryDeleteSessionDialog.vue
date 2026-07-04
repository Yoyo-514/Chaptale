<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger
} from 'reka-ui';

import { getSessionTitle } from '../../../utils/session-display';

const props = defineProps<{
  session: ChaptaleSessionListItem;
}>();

const emit = defineEmits<{
  delete: [sessionId: string];
}>();
</script>

<template>
  <AlertDialogRoot>
    <AlertDialogTrigger as-child>
      <button class="history-delete-button" type="button" :aria-label="`删除 ${getSessionTitle(props.session)}`">
        <span class="i-mingcute-delete-2-line" aria-hidden="true" />
      </button>
    </AlertDialogTrigger>
    <AlertDialogPortal>
      <AlertDialogOverlay class="history-delete-overlay" />
      <AlertDialogContent class="history-delete-dialog">
        <AlertDialogTitle class="history-delete-title">删除这个会话？</AlertDialogTitle>
        <AlertDialogDescription class="history-delete-description">
          “{{ getSessionTitle(props.session) }}” 会从本机历史记录中删除，此操作不可撤销。
        </AlertDialogDescription>
        <div class="history-delete-actions">
          <AlertDialogCancel class="history-delete-cancel">取消</AlertDialogCancel>
          <AlertDialogAction class="history-delete-confirm" @click="emit('delete', props.session.id)">
            删除
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped lang="scss">
.history-delete-button {
  @apply flex-center absolute bottom-1.5 right-1.5 size-6 border text-sm opacity-0 outline-none transition-all duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
  pointer-events: none;
}

.history-delete-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-delete-button:hover {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

:global(.history-item:hover) .history-delete-button,
:global(.history-item:focus-within) .history-delete-button {
  opacity: 1;
  pointer-events: auto;
}

:global(.history-delete-overlay) {
  @apply fixed inset-0 z-50;

  background: rgb(8 36 49 / 0.28);
  backdrop-filter: var(--blur-acrylic-subtle);
}

:global(.history-delete-dialog) {
  @apply fixed left-1/2 top-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border p-5 shadow-float;

  background: var(--popover);
  border-color: var(--border);
  border-radius: calc(var(--radius) * 0.75);
  color: var(--popover-foreground);
}

:global(.history-delete-title) {
  @apply m-0 text-base font-semibold;
}

:global(.history-delete-description) {
  @apply mt-2 mb-0 text-sm leading-6;

  color: var(--muted-foreground);
}

.history-delete-actions {
  @apply mt-5 flex justify-end gap-2;
}

.history-delete-cancel,
.history-delete-confirm {
  @apply px-3 py-2 text-sm font-medium outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
}

.history-delete-cancel {
  background: var(--surface-muted);
  color: var(--foreground);
}

.history-delete-cancel:hover {
  background: var(--secondary);
}

.history-delete-confirm {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.history-delete-confirm:hover {
  opacity: 0.9;
}

.history-delete-cancel:focus-visible,
.history-delete-confirm:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
