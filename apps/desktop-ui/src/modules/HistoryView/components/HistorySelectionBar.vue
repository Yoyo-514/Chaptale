<script setup lang="ts">
import HistoryDeleteSessionDialog from './HistoryDeleteSessionDialog.vue';

const props = defineProps<{
  selectedCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  clear: [];
  deleteSelected: [];
}>();
</script>

<template>
  <footer class="history-selection-bar">
    <div class="history-selection-bar-inner">
      <p class="history-selection-count">已选 {{ props.selectedCount }}/{{ props.totalCount }} 项</p>
      <div class="history-selection-actions">
        <button
          type="button"
          class="history-selection-clear"
          :disabled="props.selectedCount === 0"
          @click="emit('clear')"
        >
          清除选择
        </button>

        <HistoryDeleteSessionDialog
          variant="bulk"
          :selected-count="props.selectedCount"
          :disabled="props.selectedCount === 0"
          @delete-selected="emit('deleteSelected')"
        />
      </div>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.history-selection-bar {
  @apply shrink-0 border-t px-4 py-3;

  background: var(--mica-background);
  border-color: var(--border-subtle);
}

.history-selection-bar-inner {
  @apply mx-auto flex w-full max-w-4xl items-center justify-between gap-4;
}

.history-selection-count {
  @apply m-0 text-sm;

  color: var(--muted-foreground);
}

.history-selection-actions {
  @apply flex items-center gap-2;
}

.history-selection-clear {
  @apply border px-3 py-1.5 text-sm font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.history-selection-clear:hover:not(:disabled) {
  background: var(--secondary);
}

.history-selection-clear:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
