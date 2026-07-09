<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  title: string;
  icon?: string;
  status?: 'running' | 'done' | 'error';
  summary?: string;
  details?: string;
  defaultOpen?: boolean;
}>();

const open = ref(props.defaultOpen ?? false);
const statusLabel = computed(() => {
  if (props.status === 'running') return '执行中';
  if (props.status === 'error') return '失败';
  return '已完成';
});
</script>

<template>
  <article class="tool-card">
    <button class="tool-card-header" type="button" @click="open = !open">
      <span :class="icon || 'i-mingcute-tool-line'" class="tool-card-icon" aria-hidden="true" />
      <span class="tool-card-title">{{ title }}</span>
      <span :class="['tool-card-status', status && `tool-card-status-${status}`]">{{ statusLabel }}</span>
      <span :class="['i-mingcute-down-line tool-card-chevron', open && 'tool-card-chevron-open']" aria-hidden="true" />
    </button>

    <p v-if="summary" class="tool-card-summary">{{ summary }}</p>

    <div v-if="open && details" class="tool-card-details">
      <pre>{{ details }}</pre>
    </div>
  </article>
</template>

<style scoped lang="scss">
.tool-card {
  @apply max-w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-acrylic text-foreground shadow-inset-highlight;
}

.tool-card-header {
  @apply flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-muted;
}

.tool-card-icon {
  @apply shrink-0 text-primary-solid;
}

.tool-card-title {
  @apply min-w-0 flex-1 truncate font-medium;
}

.tool-card-status {
  @apply rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground;
}

.tool-card-status-running {
  @apply text-primary-solid;
}

.tool-card-status-error {
  color: var(--destructive);
}

.tool-card-chevron {
  @apply shrink-0 text-muted-foreground transition-transform duration-150;
}

.tool-card-chevron-open {
  @apply rotate-180;
}

.tool-card-summary {
  @apply line-clamp-2 px-3 pb-2 text-sm text-muted-foreground;
}

.tool-card-details {
  @apply border-t border-border-subtle bg-surface-muted/40 p-3;
}

.tool-card-details pre {
  @apply max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-secondary-foreground;
}
</style>
