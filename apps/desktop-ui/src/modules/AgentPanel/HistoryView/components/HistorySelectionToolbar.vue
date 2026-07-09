<script setup lang="ts">
import { computed } from 'vue';

import AppCheckbox from '@/components/AppCheckbox/AppCheckbox.vue';

const props = defineProps<{
  selectedCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  toggleAll: [];
}>();

const checkedState = computed(() => {
  if (props.selectedCount === 0) {
    return false;
  }

  return props.selectedCount === props.totalCount ? true : 'indeterminate';
});
</script>

<template>
  <div class="history-selection-toolbar">
    <button class="history-select-all" type="button" :disabled="props.totalCount === 0" @click="emit('toggleAll')">
      <AppCheckbox :model-value="checkedState" :disabled="props.totalCount === 0" as-child />
      <span>全选</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.history-selection-toolbar {
  @apply mx-auto mt-3 flex w-full max-w-4xl items-center;
}

.history-select-all {
  @apply inline-flex items-center gap-2 border-0 bg-transparent p-0 text-sm outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50;

  color: var(--muted-foreground);
}

.history-select-all:hover:not(:disabled) {
  color: var(--foreground);
}

.history-select-all:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
