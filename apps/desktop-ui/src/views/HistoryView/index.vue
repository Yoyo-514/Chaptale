<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '../../stores/session';
import { cn } from '../../utils';

const router = useRouter();
const sessionStore = useSessionStore();

const sessions = computed(() => sessionStore.sessions);

onMounted(() => {
  void sessionStore.loadSessions();
  void sessionStore.loadStorageDebugInfo();
});

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function getSessionTitle(session: ChaptaleSessionListItem) {
  return session.name || session.lastMessagePreview || '未命名会话';
}

async function handleSelectSession(session: ChaptaleSessionListItem) {
  await sessionStore.selectSession(session.id);
  await router.push({ name: 'chat' });
}
</script>

<template>
  <main class="history-main">
    <section class="history-panel" aria-labelledby="history-title">
      <header class="history-header">
        <div>
          <h1 id="history-title" class="history-title">历史记录</h1>
        </div>
        <p class="history-count">{{ sessions.length }} 个会话</p>
      </header>

      <div v-if="sessionStore.error" class="history-error">
        {{ sessionStore.error }}
      </div>

      <div v-else-if="sessionStore.isLoading" class="history-empty">
        <span class="i-mingcute-loading-line animate-spin" aria-hidden="true" />
        <span>正在读取历史记录...</span>
      </div>

      <div v-else-if="sessions.length === 0" class="history-empty">
        <span class="i-mingcute-inbox-2-line" aria-hidden="true" />
        <span>还没有会话，点击右上角加号开始新的创作。</span>
      </div>

      <div v-else class="history-list" role="list">
        <button
          v-for="session in sessions"
          :key="session.id"
          :class="cn('history-item', session.id === sessionStore.currentSessionId && 'history-item-active')"
          type="button"
          role="listitem"
          @click="handleSelectSession(session)"
        >
          <span class="history-item-icon" aria-hidden="true">
            <span class="i-mingcute-chat-3-line" />
          </span>

          <span class="history-item-body">
            <span class="history-item-main">
              <span class="history-item-title">{{ getSessionTitle(session) }}</span>
              <span class="history-item-time">{{ formatSessionTime(session.updatedAt) }}</span>
            </span>
            <span class="history-item-preview">
              {{ session.lastMessagePreview || '暂无消息' }}
            </span>
          </span>

          <span class="history-item-meta">
            <span>{{ session.messageCount }}</span>
          </span>
          <span class="i-mingcute-right-line" aria-hidden="true" />
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped lang="scss">
.history-main {
  @apply flex-1 overflow-y-auto px-4 pt-16 pb-8;
}

.history-panel {
  @apply mx-auto w-full max-w-4xl p-5 shadow-soft;
}

.history-header {
  @apply flex items-start justify-between gap-4 border-b pb-4;

  border-color: var(--border-subtle);
}

.history-title {
  @apply mt-1 mb-0 text-2xl font-semibold;

  color: var(--foreground);
}

.history-count {
  @apply m-0 rounded-full border px-3 py-1 text-xs;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.history-error,
.history-empty {
  @apply mt-5 flex items-center justify-center gap-2 rounded-2xl border p-8 text-sm;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.history-error {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.history-list {
  @apply mt-4 flex flex-col gap-2;
}

.history-item {
  @apply flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-all duration-150;

  border-color: transparent;
  color: var(--foreground);
}

.history-item:hover {
  background: var(--primary-hover);
}

.history-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-item-active {
  background: var(--secondary);
  border-color: var(--border-strong);
}

.history-item-icon {
  @apply flex-center size-10 shrink-0 rounded-xl border text-lg;

  background: var(--surface-muted);
  color: var(--primary-solid);
}

.history-item-body {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}

.history-item-main {
  @apply flex min-w-0 items-center justify-between gap-4;
}

.history-item-title {
  @apply truncate text-sm font-semibold;
}

.history-item-time {
  @apply shrink-0 text-xs;

  color: var(--muted-foreground);
}

.history-item-preview {
  @apply truncate text-xs;

  color: var(--muted-foreground);
}

.history-item-meta {
  @apply flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs;

  background: var(--surface-muted);
  color: var(--muted-foreground);
}
</style>
