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
import { computed } from 'vue';

import { getSessionTitle } from '../../../utils/session-display';

const props = withDefaults(
  defineProps<{
    session?: ChaptaleSessionListItem;
    selectedCount?: number;
    disabled?: boolean;
    variant?: 'icon' | 'bulk';
  }>(),
  {
    selectedCount: 0,
    disabled: false,
    variant: 'icon'
  }
);

const emit = defineEmits<{
  delete: [sessionId: string];
  deleteSelected: [];
}>();

const isBulkDelete = computed(() => props.variant === 'bulk');
const triggerLabel = computed(() => (isBulkDelete.value ? '删除选中' : ''));
const title = computed(() => (isBulkDelete.value ? '删除选中的会话？' : '删除这个会话？'));
const description = computed(() => {
  if (isBulkDelete.value) {
    return `将从本机历史记录中删除 ${props.selectedCount} 个会话，此操作不可撤销。`;
  }

  return `“${props.session ? getSessionTitle(props.session) : '未命名会话'}” 会从本机历史记录中删除，此操作不可撤销。`;
});
const confirmLabel = computed(() => (isBulkDelete.value ? `删除 ${props.selectedCount} 项` : '删除'));
const ariaLabel = computed(() => {
  if (isBulkDelete.value) {
    return '删除选中的会话';
  }

  return props.session ? `删除 ${getSessionTitle(props.session)}` : '删除会话';
});

function handleConfirm() {
  if (isBulkDelete.value) {
    emit('deleteSelected');
    return;
  }

  if (props.session) {
    emit('delete', props.session.id);
  }
}
</script>

<template>
  <AlertDialogRoot>
    <AlertDialogTrigger as-child>
      <button
        :class="['history-delete-trigger', isBulkDelete ? 'history-delete-bulk-button' : 'history-delete-button']"
        type="button"
        :aria-label="ariaLabel"
        :disabled="props.disabled"
      >
        <span v-if="!isBulkDelete" class="i-mingcute-delete-2-line" aria-hidden="true" />
        <span v-else>{{ triggerLabel }}</span>
      </button>
    </AlertDialogTrigger>
    <AlertDialogPortal>
      <AlertDialogOverlay class="history-delete-overlay" />
      <AlertDialogContent class="history-delete-dialog">
        <AlertDialogTitle class="history-delete-title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="history-delete-description">
          {{ description }}
        </AlertDialogDescription>
        <div class="history-delete-actions">
          <AlertDialogCancel class="history-delete-cancel">取消</AlertDialogCancel>
          <AlertDialogAction class="history-delete-confirm" @click="handleConfirm">
            {{ confirmLabel }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped lang="scss">
@use '../styles/dialog';

.history-delete-trigger {
  @apply outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50;
}

.history-delete-button {
  @apply flex-center absolute bottom-1.5 right-1.5 size-6 border text-sm opacity-0 transition-all duration-200 ease-out;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
  pointer-events: none;
  transform: translate(0.25rem, 0.25rem) scale(0.92);
}

.history-delete-bulk-button {
  @apply border px-3 py-1.5 text-sm font-medium;

  background: var(--destructive);
  border-color: var(--destructive);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--destructive-foreground);
}

.history-delete-bulk-button:hover:not(:disabled) {
  opacity: 0.9;
}

.history-delete-button:focus-visible,
.history-delete-bulk-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-delete-button:hover {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
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
