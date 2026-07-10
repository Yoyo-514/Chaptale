<script setup lang="ts">
import { formatTokenCount } from '@/utils/session-display';

const props = defineProps<{
  summary: string;
  tokensBefore: number;
}>();
</script>

<template>
  <details class="message-compaction" data-slot="message-compaction">
    <summary class="message-compaction-summary">
      <span class="i-mingcute-archive-line" aria-hidden="true" />
      <span> 较早的对话已压缩为摘要（原 {{ formatTokenCount(props.tokensBefore) }} tokens），点击查看 </span>
    </summary>
    <p class="message-compaction-content">{{ props.summary }}</p>
  </details>
</template>

<style scoped lang="scss">
.message-compaction {
  @apply mx-auto mb-2 w-full max-w-full rounded-xl border border-dashed text-xs;

  border-color: var(--border-subtle);
  background: var(--surface-acrylic-subtle);
  color: var(--muted-foreground);
}

.message-compaction-summary {
  @apply flex cursor-pointer select-none items-center justify-center gap-1.5 px-3 py-1.5 transition-colors duration-150;
}

.message-compaction-summary:hover {
  color: var(--foreground);
}

.message-compaction-content {
  @apply m-0 max-h-48 overflow-y-auto border-t border-dashed px-4 py-2 leading-relaxed;

  border-color: var(--border-subtle);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
</style>
