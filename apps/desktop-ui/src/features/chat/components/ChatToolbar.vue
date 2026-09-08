<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AppButton } from '@/components/AppButton';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useContentStore } from '@/features/content';
import { useNotificationStore } from '@/features/notifications';
import { SessionRenameDialog, useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

const router = useRouter();
const sessionStore = useSessionStore();
const notificationStore = useNotificationStore();
const navigation = useWorkbenchStore();
const content = useContentStore();
const settings = useSettingsStore();
const switching = ref(false);
const personaId = computed(() => currentSession.value?.personaId ?? 'companion');

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
  await selectPersona(personaId.value, true);
}
async function selectPersona(id: string, force = false) {
  if (id === '__manage') {
    settings.openPanel('content');
    return;
  }
  if (navigation.agentBusy || switching.value || (!force && currentSession.value && id === personaId.value)) return;
  switching.value = true;
  try {
    const index = sessionStore.sessions.length + 1;
    await sessionStore.createSession({ name: `新会话 ${index}`, ...(id !== 'companion' ? { personaId: id } : {}) });
    await router.push({ name: 'chat' });
  } catch (cause) {
    notificationStore.error('创建会话失败', cause instanceof Error ? cause.message : String(cause));
  } finally {
    switching.value = false;
  }
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
    <div class="chat-persona">
      <AppSelect
        :model-value="personaId"
        aria-label="对话专员"
        :disabled="navigation.agentBusy || switching"
        @update:model-value="selectPersona($event)"
      >
        <AppSelectItem v-for="persona in content.chats" :key="persona.id" :value="persona.id">{{
          persona.name
        }}</AppSelectItem>
        <AppSelectItem v-if="!content.chats.some(item => item.id === personaId)" :value="personaId">{{
          personaId === 'companion' ? '创作伙伴' : `${personaId} · 不可用`
        }}</AppSelectItem>
        <AppSelectItem value="__manage">管理专员</AppSelectItem>
      </AppSelect>
    </div>
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
.chat-persona {
  @apply min-w-0;
  width: 140px;
  max-width: 100%;
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
