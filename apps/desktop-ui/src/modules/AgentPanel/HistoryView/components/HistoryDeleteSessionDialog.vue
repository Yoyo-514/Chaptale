<script setup lang="ts">
import { computed } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { getSessionTitle } from '@/utils/session-display';

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
  <AppAlertDialog :title="title" :description="description" :confirm-label="confirmLabel" @confirm="handleConfirm">
    <template #trigger>
      <AppButton
        :class="isBulkDelete ? undefined : 'history-delete-button'"
        :icon="!isBulkDelete"
        variant="danger"
        type="button"
        size="xs"
        :aria-label="ariaLabel"
        :disabled="props.disabled"
      >
        <span v-if="!isBulkDelete" class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
        <span v-else>{{ triggerLabel }}</span>
      </AppButton>
    </template>
  </AppAlertDialog>
</template>

<style scoped lang="scss">
.history-delete-button {
  @apply absolute bottom-1.5 right-1.5 opacity-0 transition-all duration-200 ease-out;

  background: var(--surface-acrylic-strong);
  pointer-events: none;
  transform: translate(0.25rem, 0.25rem) scale(0.92);
}
</style>
