<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { formatSessionTime, getSessionTitle } from '@/utils/session-display';

// public 目录资源按根路径引用；动态绑定可避免 plugin-vue 将其作为模块导入（vitest 环境会解析失败）
const appIconUrl = '/favicon.ico';

const props = defineProps<{
  recentSessions: ChaptaleSessionListItem[];
}>();

const emit = defineEmits<{
  selectSession: [sessionId: string];
}>();
</script>

<template>
  <div class="chat-empty-state">
    <img class="chat-empty-icon" :src="appIconUrl" alt="Chaptale" />
    <p class="chat-empty-tip">今天想写什么？</p>

    <div v-if="props.recentSessions.length > 0" class="chat-recent-section">
      <div class="chat-recent-title">最近任务</div>
      <div class="chat-recent-list">
        <button
          v-for="session in props.recentSessions"
          :key="session.id"
          class="chat-recent-item"
          type="button"
          @click="emit('selectSession', session.id)"
        >
          <span class="chat-recent-item-main">
            <span class="chat-recent-item-title">{{ getSessionTitle(session) }}</span>
            <span class="chat-recent-item-preview">{{ session.lastMessagePreview || '暂无消息' }}</span>
          </span>
          <span class="chat-recent-item-time">{{ formatSessionTime(session.updatedAt) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-empty-state {
  @apply mx-auto flex w-full max-w-md flex-col items-center text-center;
}

.chat-empty-icon {
  @apply size-28 select-none;
}

.chat-empty-tip {
  @apply mt-3 mb-0;

  color: var(--muted-foreground);
  font-size: var(--chat-content-font-size, 0.875rem);
  line-height: var(--chat-content-line-height, 1.5rem);
}

.chat-recent-section {
  @apply mt-8 w-full text-left;
}

.chat-recent-title {
  @apply mb-2 px-1 text-xs font-medium;

  color: var(--muted-foreground);
}

.chat-recent-list {
  @apply flex flex-col gap-1.5;
}

.chat-recent-item {
  @apply flex w-full items-center justify-between gap-3 border px-3 py-2 text-left outline-none transition-colors duration-150;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.chat-recent-item:hover {
  background: var(--surface-muted);
}

.chat-recent-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.chat-recent-item-main {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}

.chat-recent-item-title {
  @apply truncate text-xs font-medium;
}

.chat-recent-item-preview {
  @apply truncate text-xs;

  color: var(--muted-foreground);
}

.chat-recent-item-time {
  @apply shrink-0 text-xs;

  color: var(--muted-foreground);
}
</style>
