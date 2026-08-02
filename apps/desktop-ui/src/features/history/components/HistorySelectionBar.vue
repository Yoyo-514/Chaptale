<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

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
        <AppButton size="xs" type="button" :disabled="props.selectedCount === 0" @click="emit('clear')">
          清除选择
        </AppButton>

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
  @apply shrink-0 border-t px-3 py-2;

  background: var(--mica-background);
  border-color: var(--border-subtle);
}

.history-selection-bar-inner {
  @apply mx-auto flex w-full max-w-4xl items-center justify-between gap-2;
}

.history-selection-count {
  @apply m-0 text-xs;

  color: var(--muted-foreground);
}

.history-selection-actions {
  @apply flex items-center gap-2;
}
</style>
