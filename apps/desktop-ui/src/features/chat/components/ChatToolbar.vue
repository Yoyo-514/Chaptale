<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useNotificationStore } from '@/features/notifications';
import { SessionRenameDialog } from '@/features/sessions';
import { useSessionStore } from '@/stores/session';

const router = useRouter();
const sessionStore = useSessionStore();
const notificationStore = useNotificationStore();

const currentSession = computed(() => sessionStore.currentSession);
const sessionTitle = computed(() => {
  const session = currentSession.value;
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

async function handleRenameSession(sessionId: string, name: string) {
  await sessionStore.renameSession(sessionId, name);
}

async function handleExportSession() {
  const sessionId = sessionStore.currentSessionId;

  if (!sessionId) {
    return;
  }

  const savedPath = await sessionStore.exportSessionHtml(sessionId);

  if (savedPath) {
    notificationStore.success('会话已导出', savedPath);
  } else if (sessionStore.error) {
    notificationStore.error('导出失败', sessionStore.error);
  }
}
</script>

<template>
  <div class="chat-toolbar" aria-label="聊天工具栏">
    <div class="chat-toolbar-title" :title="sessionTitle">
      <span class="i-mingcute-chat-3-line chat-toolbar-title-icon" aria-hidden="true" />
      <span class="chat-toolbar-title-text">{{ sessionTitle }}</span>
      <SessionRenameDialog
        v-if="currentSession"
        :session="currentSession"
        trigger-class="chat-toolbar-rename"
        @rename="handleRenameSession"
      />
    </div>

    <div class="chat-toolbar-actions">
      <AppTooltip text="导出会话为 HTML" side="bottom" :side-offset="3">
        <AppButton
          icon
          variant="ghost"
          size="sm"
          type="button"
          aria-label="导出会话为 HTML"
          :disabled="!currentSession"
          @click="handleExportSession"
        >
          <span class="i-mingcute-download-2-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>

      <AppTooltip text="新建会话" side="bottom" :side-offset="3">
        <AppButton icon variant="ghost" size="sm" type="button" aria-label="新建会话" @click="handleCreateSession">
          <span class="i-mingcute-add-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>

      <AppTooltip text="历史记录" side="bottom" :side-offset="3">
        <AppButton icon variant="ghost" size="sm" type="button" aria-label="历史记录" @click="handleOpenHistory">
          <span class="i-mingcute-history-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-toolbar {
  @apply flex min-w-0 items-center justify-between gap-2 border-b px-1 pb-2;

  border-color: var(--border-subtle);
}

.chat-toolbar-title {
  @apply flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium;

  color: var(--muted-foreground);
}

.chat-toolbar-title-icon {
  @apply shrink-0 text-sm;

  color: var(--primary-solid);
}

.chat-toolbar-title-text {
  @apply min-w-0 truncate;
}

.chat-toolbar-title :deep(.chat-toolbar-rename) {
  @apply shrink-0 opacity-0 transition-opacity duration-150;
}

.chat-toolbar-title:hover :deep(.chat-toolbar-rename),
.chat-toolbar-title:focus-within :deep(.chat-toolbar-rename) {
  opacity: 1;
}

.chat-toolbar-actions {
  @apply flex shrink-0 items-center gap-1;
}
</style>
