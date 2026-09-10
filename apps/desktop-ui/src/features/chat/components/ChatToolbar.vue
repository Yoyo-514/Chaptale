<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useContentStore } from '@/features/content';
import { useNotificationStore } from '@/features/notifications';
import { SessionRenameDialog, useSessionStore } from '@/features/sessions';
import { useWorkbenchStore } from '@/features/workbench';

import { useChatPersona } from '../composables/useChatPersona';

const router = useRouter();
const sessionStore = useSessionStore();
const notificationStore = useNotificationStore();
const navigation = useWorkbenchStore();
const content = useContentStore();
// 专员选择器已移到输入框状态栏；工具栏只保留会话本身的操作，换专员统一走这里。
const persona = useChatPersona();

const currentSession = computed(() => sessionStore.currentSession);
const sessionTitle = computed(() => {
  const session = currentSession.value;
  return session?.name || session?.lastMessagePreview || '未命名会话';
});

onMounted(() => {
  void sessionStore.loadSessions();
  void content.refresh();
});
watch(
  () => content.context.rootPath,
  () => void content.refresh()
);

async function handleCreateSession() {
  // 新建会话沿用当前专员，但不触发切换确认：这一步是作者主动要新会话。
  await persona.createSessionWith(persona.personaId.value);
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
        <AppButton
          icon
          variant="ghost"
          size="sm"
          type="button"
          aria-label="新建会话"
          :disabled="navigation.agentBusy"
          @click="handleCreateSession"
        >
          <span class="i-mingcute-add-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>

      <AppTooltip text="历史记录" side="bottom" :side-offset="3">
        <AppButton
          icon
          variant="ghost"
          size="sm"
          type="button"
          aria-label="历史记录"
          :disabled="navigation.agentBusy"
          @click="handleOpenHistory"
        >
          <span class="i-mingcute-history-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-toolbar {
  @apply flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-2 pb-1;

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
