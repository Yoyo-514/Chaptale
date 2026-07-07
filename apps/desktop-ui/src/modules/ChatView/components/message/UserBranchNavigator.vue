<script setup lang="ts">
import type { MessageBranchControl } from '../../types';

defineProps<{
  branch: MessageBranchControl;
}>();

const emit = defineEmits<{
  switchBranch: [leafId: string];
}>();
</script>

<template>
  <div class="user-branch-navigator" aria-label="消息分支">
    <button
      class="user-branch-button"
      type="button"
      title="上一个分支"
      :disabled="!branch.previousLeafId"
      @click="branch.previousLeafId && emit('switchBranch', branch.previousLeafId)"
    >
      <span class="i-mingcute-left-line" aria-hidden="true" />
    </button>
    <span class="user-branch-count">{{ branch.current }} / {{ branch.total }}</span>
    <button
      class="user-branch-button"
      type="button"
      title="下一个分支"
      :disabled="!branch.nextLeafId"
      @click="branch.nextLeafId && emit('switchBranch', branch.nextLeafId)"
    >
      <span class="i-mingcute-right-line" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.user-branch-navigator {
  @apply mr-1 flex items-center gap-1 rounded-full bg-surface-acrylic px-1 py-0.5 text-xs text-muted-foreground shadow-inset-highlight;
}

.user-branch-button {
  @apply flex-center rounded-full p-0.5 transition-colors duration-150 hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35;
}

.user-branch-count {
  @apply min-w-10 text-center tabular-nums;
}
</style>
