<script setup lang="ts">
import { ref } from 'vue';

import type { TodoItem } from '@chaptale/shared';

const props = defineProps<{
  items: TodoItem[];
  total: number;
  completedCount: number;
}>();

const collapsed = ref(false);

const statusMeta: Record<TodoItem['status'], { icon: string; className: string }> = {
  completed: { icon: 'i-mingcute-check-circle-fill', className: 'todo-item-completed' },
  in_progress: { icon: 'i-mingcute-loading-3-line animate-spin', className: 'todo-item-current' },
  pending: { icon: 'i-mingcute-round-line', className: 'todo-item-pending' }
};
</script>

<template>
  <section class="todo-card" aria-label="任务进度">
    <button type="button" class="todo-card-header" @click="collapsed = !collapsed">
      <span class="todo-card-title">
        <span class="i-mingcute-list-check-line size-4" aria-hidden="true" />
        任务进度 {{ props.completedCount }}/{{ props.total }}
      </span>
      <span :class="['size-4', collapsed ? 'i-mingcute-down-line' : 'i-mingcute-up-line']" aria-hidden="true" />
    </button>

    <ul v-show="!collapsed" class="todo-list">
      <li v-for="item in props.items" :key="item.id" class="todo-item" :class="statusMeta[item.status].className">
        <span :class="['size-4 shrink-0', statusMeta[item.status].icon]" aria-hidden="true" />
        <span class="todo-item-content">{{ item.content }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.todo-card {
  @apply mx-4 mt-2 rounded-lg border border-border bg-card text-sm shadow-sm;
}

.todo-card-header {
  @apply flex w-full items-center justify-between px-4 py-2 text-left;
}

.todo-card-title {
  @apply flex items-center gap-1.5 font-medium text-foreground;
}

.todo-list {
  @apply space-y-1 px-4 pb-3;
}

.todo-item {
  @apply flex items-center gap-2;
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
