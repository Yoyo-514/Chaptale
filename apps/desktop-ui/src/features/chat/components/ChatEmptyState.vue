<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { APP_ICON_URL } from '@/utils/app-icon';
import { formatSessionTime, getSessionTitle } from '@/utils/session-display';

const appIconUrl = APP_ICON_URL;

const props = defineProps<{
  recentSessions: ChaptaleSessionListItem[];
  /** 作者还没开始过时才会出现概念说明：老作者不需要每次新会话都重读一遍。 */
  showConcepts: boolean;
}>();

const emit = defineEmits<{
  selectSession: [sessionId: string];
}>();
</script>

<template>
  <div class="chat-empty-state">
    <img class="chat-empty-icon" :src="appIconUrl" alt="Chaptale" />
    <p class="chat-empty-tip">今天想写什么？</p>

    <p v-if="props.showConcepts" class="chat-empty-concepts">
      每个会话由一位专员负责：故事策划陪你定方向，候选稿写作负责成稿，审查专员挑毛病。
    </p>

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

.chat-empty-concepts {
  @apply mt-2 mb-0 max-w-sm;

  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.5;
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
  background: var(--surface-hover);
}

.chat-recent-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.chat-recent-item-main {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}

.chat-recent-item-title {
  @apply truncate font-medium;
  font-size: var(--ui-font-size);
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
