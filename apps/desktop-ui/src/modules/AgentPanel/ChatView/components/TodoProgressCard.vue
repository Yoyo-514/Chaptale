<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppCollapsible } from '@/components/AppCollapsible';
import { AppScrollArea } from '@/components/AppScrollArea';
import type { TodoItem } from '@chaptale/shared';

const props = defineProps<{
  items: TodoItem[];
  total: number;
  completedCount: number;
}>();

// 默认收起：折叠行已含当前进行项与进度，展开仅用于查看全表。
const open = ref(false);

const allDone = computed(() => props.total > 0 && props.completedCount === props.total);

// 全部完成后自动收起，保持输入区上方简洁。
watch(allDone, done => {
  if (done) {
    open.value = false;
  }
});

const currentItem = computed(() => props.items.find(item => item.status === 'in_progress'));

const headline = computed(() => {
  if (allDone.value) {
    return '任务完成';
  }

  return currentItem.value ? (currentItem.value.activeForm ?? currentItem.value.content) : '任务清单';
});

const headlineIcon = computed(() => {
  if (allDone.value) {
    return 'i-mingcute-check-circle-fill text-primary';
  }

  return currentItem.value ? 'i-mingcute-loading-3-line animate-spin' : 'i-mingcute-list-check-line';
});

/** 进行中项显示进行时文案（activeForm），其余显示原始描述。 */
function itemLabel(item: TodoItem): string {
  return item.status === 'in_progress' ? (item.activeForm ?? item.content) : item.content;
}

const statusMeta: Record<TodoItem['status'], { icon: string; className: string }> = {
  completed: { icon: 'i-mingcute-check-circle-fill', className: 'todo-item-completed' },
  in_progress: { icon: 'i-mingcute-loading-3-line animate-spin', className: 'todo-item-current' },
  pending: { icon: 'i-mingcute-round-line', className: 'todo-item-pending' }
};
</script>

<template>
  <AppCollapsible v-model="open" class="todo-progress" content-class="todo-progress-content" aria-label="任务进度">
    <template #trigger="{ open: isOpen }">
      <button type="button" class="todo-progress-trigger">
        <span :class="['size-4 shrink-0', headlineIcon]" aria-hidden="true" />
        <span class="todo-progress-headline">{{ headline }}</span>
        <span class="todo-progress-count">{{ props.completedCount }}/{{ props.total }}</span>
        <span
          :class="['size-4 shrink-0 todo-progress-chevron', isOpen ? 'i-mingcute-down-line' : 'i-mingcute-up-line']"
          aria-hidden="true"
        />
      </button>
    </template>

    <AppScrollArea class="todo-progress-scroll">
      <ul class="todo-list">
        <li v-for="item in props.items" :key="item.id" class="todo-item" :class="statusMeta[item.status].className">
          <span :class="['size-3.5 shrink-0', statusMeta[item.status].icon]" aria-hidden="true" />
          <span class="todo-item-content">{{ itemLabel(item) }}</span>
        </li>
      </ul>
    </AppScrollArea>
  </AppCollapsible>
</template>

<style scoped lang="scss">
.todo-progress {
  // 列表向上展开，折叠行始终贴近输入框。
  @apply flex flex-col-reverse text-sm;
}

.todo-progress-trigger {
  @apply flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left outline-none;

  color: var(--foreground);

  &:hover {
    background: var(--surface-muted);
  }
}

.todo-progress-headline {
  @apply min-w-0 flex-1 truncate font-medium;
}

.todo-progress-count,
.todo-progress-chevron {
  @apply text-xs;

  color: var(--muted-foreground);
}

:deep(.todo-progress-content) {
  @apply p-0;

  border-bottom: 1px solid var(--border-subtle);
}

.todo-progress-scroll {
  // 至多 5 项可见（每项 1.75rem），超出滚动。
  max-height: calc(5 * 1.75rem);
}

.todo-list {
  @apply px-3 py-1;
}

.todo-item {
  @apply flex h-7 items-center gap-2;
}

.todo-item-content {
  @apply truncate;
}

.todo-item-completed {
  @apply text-muted-foreground;

  .todo-item-content {
    @apply line-through;
  }
}

.todo-item-current {
  @apply font-medium text-foreground;
}

.todo-item-pending {
  @apply text-muted-foreground;
}
</style>
