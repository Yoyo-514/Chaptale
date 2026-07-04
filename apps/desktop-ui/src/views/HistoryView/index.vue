<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '../../stores/session';
import HistorySessionItem from './components/HistorySessionItem.vue';

const router = useRouter();
const sessionStore = useSessionStore();

const sessions = computed(() => sessionStore.sessions);

onMounted(() => {
  void sessionStore.loadSessions();
  void sessionStore.loadStorageDebugInfo();
});

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
        <HistorySessionItem
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          :is-active="session.id === sessionStore.currentSessionId"
          @select="handleSelectSession"
          @delete="handleDeleteSession"
        />
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
</style>
