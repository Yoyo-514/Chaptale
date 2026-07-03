<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger
} from 'reka-ui';
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

async function handleDeleteSession(sessionId: string) {
  await sessionStore.deleteSession(sessionId);
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
        <div
          v-for="session in sessions"
          :key="session.id"
          :class="cn('history-item', session.id === sessionStore.currentSessionId && 'history-item-active')"
          role="listitem"
        >
          <button class="history-item-select" type="button" @click="handleSelectSession(session)">
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
            <span class="i-mingcute-right-line history-item-arrow" aria-hidden="true" />
          </button>

          <AlertDialogRoot>
            <AlertDialogTrigger as-child>
              <button class="history-delete-button" type="button" :aria-label="`删除 ${getSessionTitle(session)}`">
                <span class="i-mingcute-delete-2-line" aria-hidden="true" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogPortal>
              <AlertDialogOverlay class="history-delete-overlay" />
              <AlertDialogContent class="history-delete-dialog">
                <AlertDialogTitle class="history-delete-title">删除这个会话？</AlertDialogTitle>
                <AlertDialogDescription class="history-delete-description">
                  “{{ getSessionTitle(session) }}” 会从本机历史记录中删除，此操作不可撤销。
                </AlertDialogDescription>
                <div class="history-delete-actions">
                  <AlertDialogCancel class="history-delete-cancel">取消</AlertDialogCancel>
                  <AlertDialogAction class="history-delete-confirm" @click="handleDeleteSession(session.id)">
                    删除
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialogPortal>
          </AlertDialogRoot>
        </div>
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
  @apply relative flex w-full items-center gap-2 border p-2 transition-all duration-150;

  border-color: transparent;
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.history-item:hover {
  background: var(--primary-hover);
}

.history-item-active {
  background: var(--secondary);
  border-color: var(--border-strong);
}

.history-item-select {
  @apply flex min-w-0 flex-1 items-center gap-3 p-1 text-left outline-none;
}

.history-item-select:focus-visible,
.history-delete-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-item-icon {
  @apply flex-center size-10 shrink-0 border text-lg;

  background: var(--surface-muted);
  border-radius: calc(var(--radius) * 0.5);
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

.history-item-arrow {
  @apply shrink-0 transition-all duration-150;
}

.history-item:hover .history-item-arrow,
.history-item:focus-within .history-item-arrow {
  @apply translate-y-[-0.75rem];
}

.history-delete-button {
  @apply flex-center absolute bottom-1.5 right-1.5 size-6 border text-sm opacity-0 outline-none transition-all duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
  pointer-events: none;
}

.history-item:hover .history-delete-button,
.history-item:focus-within .history-delete-button {
  opacity: 1;
  pointer-events: auto;
}

.history-delete-button:hover {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

:global(.history-delete-overlay) {
  @apply fixed inset-0 z-50;

  background: rgb(8 36 49 / 0.28);
  backdrop-filter: var(--blur-acrylic-subtle);
}

:global(.history-delete-dialog) {
  @apply fixed left-1/2 top-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border p-5 shadow-float;

  background: var(--popover);
  border-color: var(--border);
  border-radius: calc(var(--radius) * 0.75);
  color: var(--popover-foreground);
}

:global(.history-delete-title) {
  @apply m-0 text-base font-semibold;
}

:global(.history-delete-description) {
  @apply mt-2 mb-0 text-sm leading-6;

  color: var(--muted-foreground);
}

.history-delete-actions {
  @apply mt-5 flex justify-end gap-2;
}

.history-delete-cancel,
.history-delete-confirm {
  @apply px-3 py-2 text-sm font-medium outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
}

.history-delete-cancel {
  background: var(--surface-muted);
  color: var(--foreground);
}

.history-delete-cancel:hover {
  background: var(--secondary);
}

.history-delete-confirm {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.history-delete-confirm:hover {
  opacity: 0.9;
}

.history-delete-cancel:focus-visible,
.history-delete-confirm:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
