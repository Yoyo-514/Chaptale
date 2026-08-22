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
// 与同行的 message-actions 保持同一视觉重量：胶囊底色会让这一行出现一块突兀的浮块。
.user-branch-navigator {
  @apply flex items-center text-muted-foreground;
}

.user-branch-count {
  @apply min-w-8 text-center text-[11px] tabular-nums;
}
</style>
