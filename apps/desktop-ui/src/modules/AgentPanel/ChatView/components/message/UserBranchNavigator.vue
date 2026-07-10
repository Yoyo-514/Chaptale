<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
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
    <AppButton
      icon
      variant="ghost"
      size="xs"
      type="button"
      title="上一个分支"
      :disabled="!branch.previousLeafId"
      @click="branch.previousLeafId && emit('switchBranch', branch.previousLeafId)"
    >
      <span class="i-mingcute-left-line size-3.5" aria-hidden="true" />
    </AppButton>
    <span class="user-branch-count">{{ branch.current }} / {{ branch.total }}</span>
    <AppButton
      icon
      variant="ghost"
      size="xs"
      type="button"
      title="下一个分支"
      :disabled="!branch.nextLeafId"
      @click="branch.nextLeafId && emit('switchBranch', branch.nextLeafId)"
    >
      <span class="i-mingcute-right-line size-3.5" aria-hidden="true" />
    </AppButton>
  </div>
</template>

<style scoped lang="scss">
.user-branch-navigator {
  @apply mr-1 flex items-center rounded-full bg-surface-acrylic px-1 py-0.5 text-xs text-muted-foreground shadow-inset-highlight;
}

.user-branch-count {
  @apply min-w-10 text-center tabular-nums;
}
</style>
