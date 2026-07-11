<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppCollapsible } from '@/components/AppCollapsible';

const props = defineProps<{
  title: string;
  icon?: string;
  status?: 'running' | 'done' | 'error';
  summary?: string;
  details?: string;
  defaultOpen?: boolean;
  searchOpen?: boolean;
}>();

const open = ref(props.defaultOpen ?? false);

watch(
  () => props.searchOpen,
  searchOpen => {
    if (searchOpen) open.value = true;
  },
  { immediate: true }
);

const statusLabel = computed(() => {
  if (props.status === 'running') return '执行中';
  if (props.status === 'error') return '失败';
  if (props.status === 'done') return '已完成';
  return '';
});
</script>

<template>
  <AppCollapsible
    v-model="open"
    variant="plain"
    :class="['tool-message-section', props.searchOpen && 'is-search-hit']"
    trigger-class="tool-message-section-trigger"
    content-class="tool-message-section-content"
    :unmount-on-hide="false"
  >
    <template #trigger="{ open: isOpen, triggerClass }">
      <button :class="triggerClass" type="button">
        <span :class="props.icon || 'i-mingcute-tool-line'" class="tool-message-section-icon" aria-hidden="true" />
        <span class="tool-message-section-heading">
          <span class="tool-message-section-title">{{ props.title }}</span>
          <span v-if="props.summary" class="tool-message-section-summary">{{ props.summary }}</span>
        </span>
        <span v-if="statusLabel" :class="['tool-message-section-status', props.status && `is-${props.status}`]">
          {{ statusLabel }}
        </span>
        <span :class="['i-mingcute-down-line tool-message-section-chevron', isOpen && 'is-open']" aria-hidden="true" />
      </button>
    </template>

    <slot>
      <pre v-if="props.details" class="tool-message-section-details">{{ props.details }}</pre>
      <p v-else class="tool-message-section-empty">暂无详细内容</p>
    </slot>
  </AppCollapsible>
</template>

<style scoped lang="scss">
.tool-message-section {
  @apply min-w-0 border-b last:border-b-0;

  border-color: var(--border-subtle);
}

.tool-message-section.is-search-hit {
  @apply rounded;

  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

.tool-message-section :deep(.tool-message-section-trigger) {
  @apply flex w-full items-center gap-2 px-2 py-2 text-left;
}

.tool-message-section-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.tool-message-section-heading {
  @apply flex min-w-0 flex-1 flex-col;
}

.tool-message-section-title {
  @apply truncate text-xs font-medium;
}

.tool-message-section-summary {
  @apply line-clamp-1 text-[11px];

  color: var(--muted-foreground);
}

.tool-message-section-status {
  @apply shrink-0 text-[11px];

  color: var(--muted-foreground);
}

.tool-message-section-status.is-running {
  color: var(--primary-solid);
}

.tool-message-section-status.is-error {
  color: var(--destructive);
}

.tool-message-section-chevron {
  @apply shrink-0 text-sm transition-transform duration-150;

  color: var(--muted-foreground);
}

.tool-message-section-chevron.is-open {
  transform: rotate(180deg);
}

.tool-message-section :deep(.tool-message-section-content) {
  @apply px-2 pb-2;
}

.tool-message-section-details {
  @apply m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md p-2 text-xs;

  background: var(--surface-muted);
  color: var(--secondary-foreground);
}

.tool-message-section-empty {
  @apply m-0 text-xs;

  color: var(--muted-foreground);
}
</style>
