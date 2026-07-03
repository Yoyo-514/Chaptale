<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '../../../stores/session';

const router = useRouter();
const sessionStore = useSessionStore();

const sessionTitle = computed(() => {
  const session = sessionStore.currentSession;
  return session?.name || session?.lastMessagePreview || '未命名会话';
});

onMounted(() => {
  void sessionStore.loadSessions();
});

async function handleCreateSession() {
  const index = sessionStore.sessions.length + 1;
  await sessionStore.createSession({ name: `新会话 ${index}` });
  await router.push({ name: 'chat' });
}

async function handleOpenHistory() {
  await sessionStore.loadSessions();
  await router.push({ name: 'history' });
}
</script>

<template>
  <TooltipProvider :delay-duration="120">
    <div class="session-toolbar" aria-label="当前会话工具栏">
      <div class="session-toolbar-title" :title="sessionTitle">
        <span class="i-mingcute-chat-3-line session-toolbar-title-icon" aria-hidden="true" />
        <span class="session-toolbar-title-text">{{ sessionTitle }}</span>
      </div>

      <div class="session-toolbar-actions">
        <TooltipRoot>
          <TooltipTrigger as-child>
            <button class="session-toolbar-button" type="button" aria-label="新建会话" @click="handleCreateSession">
              <span class="i-mingcute-add-line" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent class="session-toolbar-tooltip" side="bottom" align="center" :side-offset="3">
              新建会话
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>

        <TooltipRoot>
          <TooltipTrigger as-child>
            <button class="session-toolbar-button" type="button" aria-label="历史记录" @click="handleOpenHistory">
              <span class="i-mingcute-history-line" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent class="session-toolbar-tooltip" side="bottom" align="center" :side-offset="3">
              历史记录
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </div>
    </div>
  </TooltipProvider>
</template>

<style scoped lang="scss">
.session-toolbar {
  @apply flex min-w-0 items-center justify-between gap-2 border-b px-1 pb-2;

  border-color: var(--border-subtle);
}

.session-toolbar-title {
  @apply flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium;

  color: var(--muted-foreground);
}

.session-toolbar-title-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.session-toolbar-title-text {
  @apply min-w-0 truncate;
}

.session-toolbar-actions {
  @apply flex shrink-0 items-center gap-1;
}

.session-toolbar-button {
  @apply flex-center size-7 text-base outline-none transition-colors duration-150;

  color: var(--muted-foreground);
}

.session-toolbar-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.session-toolbar-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

:global(.session-toolbar-tooltip) {
  @apply z-50 border px-2 py-1 text-xs shadow-soft;

  background: var(--popover);
  border-color: var(--border);
  color: var(--popover-foreground);
  backdrop-filter: var(--blur-acrylic-subtle);
}
</style>
