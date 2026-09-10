<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { MemoryPendingCard, useMemoryPending } from '@/features/memory-review';
import { useNotificationStore } from '@/features/notifications';
import { PermissionRequestCard, usePermissionRequests } from '@/features/permissions';
import { ReviewResultStrip, useReviewLanes } from '@/features/reviews';
import { useSessionStore } from '@/features/sessions';
import { SubagentTaskCard, useSubagentTasks } from '@/features/subagent-tasks';
import { TodoProgressCard, useTodoProgress } from '@/features/todo-progress';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { cn } from '@/utils';
import { toErrorMessage } from '@/utils/desktop-api';

import ChatEmptyState from './components/ChatEmptyState.vue';
import ChatInputBox from './components/ChatInput/ChatInputBox.vue';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatSearchBar from './components/ChatSearchBar.vue';
import ContextPressureCard from './components/ContextPressureCard.vue';
import SessionDamageNotice from './components/SessionDamageNotice.vue';
import { useChatController } from './composables/useChatController';
import { useChatSearch } from './composables/useChatSearch';
import { useContextCompaction } from './composables/useContextCompaction';

const chat = useChatController();
const sessionStore = useSessionStore();
const navigation = useWorkbenchStore();
const workspace = useWorkspaceStore();
const root = ref<HTMLElement>();
watchEffect(() => {
  navigation.agentBusy = chat.state.isConnecting || chat.state.isReplying;
  navigation.agentCancelling = chat.state.isCancelling;
});
watch(
  () => navigation.cancelAgentRequest,
  () => void chat.cancelActiveRun()
);
onBeforeUnmount(() => {
  navigation.agentBusy = false;
  navigation.agentCancelling = false;
});
let applyingContext = false;
async function applyContextRequests() {
  if (applyingContext || chat.state.isConnecting || chat.state.isReplying) return;
  applyingContext = true;
  try {
    while (navigation.agentRequests.length) {
      const request = navigation.agentRequests[0]!;
      if (request.rootPath !== workspace.rootPath) {
        navigation.agentRequests.shift();
        continue;
      }
      try {
        if (request.files.length)
          await chat.addWorkspaceFiles(request.files, () => request.rootPath === workspace.rootPath);
        if (request.rootPath !== workspace.rootPath) continue;
        chat.state.input = [chat.state.input.trim(), request.prompt].filter(Boolean).join('\n\n');
      } catch (error) {
        useNotificationStore().error('添加 Agent 上下文失败', toErrorMessage(error));
      }
      navigation.agentRequests.shift();
    }
    await nextTick();
    root.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  } finally {
    applyingContext = false;
  }
}
watch(
  () => [navigation.agentRequests.length, chat.state.isConnecting, chat.state.isReplying],
  () => void applyContextRequests(),
  { immediate: true }
);
const todoProgress = useTodoProgress(() => sessionStore.currentSessionId);
const permissionRequests = usePermissionRequests(() => sessionStore.currentSessionId);
const memoryPending = useMemoryPending();
const subagentTasks = useSubagentTasks(() => sessionStore.currentSessionId);
const contextCompaction = useContextCompaction(
  () => sessionStore.currentSessionId,
  async () => {
    await Promise.all([sessionStore.loadSessions(), chat.reloadCurrentSessionMessages()]);
  }
);
const review = useReviewLanes(
  () => chat.state.input,
  () => chat.state.contextFiles.map(file => file.path)
);

const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
const search = useChatSearch(() => chat.state.messages);
const searchHit = computed(() => (search.isOpen.value ? search.activeMatch.value : undefined));
// 会话文件的损坏计数来自列表项：list() 已经完整解析过文件，不必为它再读一次盘。
// 排在提示区最上——同区其他卡片都有终态，处理完就消失，理应离输入框更近。
const damagedEntryCount = computed(() => sessionStore.currentSession?.damagedEntryCount ?? 0);

// 每轮终态会刷新会话列表 updatedAt；据此重查 SDK 的“当前上下文”水位，而非累计 token。
watch(
  () => sessionStore.currentSession?.updatedAt,
  (updatedAt, previousUpdatedAt) => {
    if (updatedAt && updatedAt !== previousUpdatedAt) {
      void contextCompaction.refresh();
    }
  }
);

watch(
  () => subagentTasks.tasks.value,
  tasks => {
    void review.attachSubagentTasks(tasks).catch(error => console.warn('同步审查结果失败', error));
  }
);

async function scrollMessagesToBottom() {
  await nextTick();
  await messageListRef.value?.scrollToBottom();
}

async function handleSend() {
  await chat.handleSend();
  await scrollMessagesToBottom();
}

async function handleSaveUserMessage(messageId: string, content: string) {
  await chat.handleSaveUserMessage(messageId, content);
  await scrollMessagesToBottom();
}

async function handleRegenerateAssistantMessage(messageId: string) {
  await chat.handleRegenerateAssistantMessage(messageId);
  await scrollMessagesToBottom();
}

async function handleSwitchBranch(leafId: string) {
  await chat.handleSwitchBranch(leafId);
}

watch(
  () => search.activeMatch.value,
  async match => {
    if (match) {
      await messageListRef.value?.scrollToIndex(match.index);
    }
  }
);

function handleGlobalKeydown(event: KeyboardEvent) {
  if (
    !event.defaultPrevented &&
    root.value?.contains(event.target as Node) &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'f'
  ) {
    event.preventDefault();
    search.open();
  }
}

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));
</script>

<template>
  <main ref="root" :class="cn('chat-main', chat.isWelcome.value && 'chat-main-welcome')">
    <section :class="cn('chat-messages-section', chat.isWelcome.value && 'chat-messages-section-welcome')">
      <ChatEmptyState
        v-if="chat.isWelcome.value"
        :recent-sessions="chat.recentSessions.value"
        @select-session="chat.handleSelectRecentSession"
      />

      <template v-else>
        <ChatSearchBar
          v-model:query="search.query.value"
          :open="search.isOpen.value"
          :match-count="search.matches.value.length"
          :active-match-index="search.activeMatchIndex.value"
          @close="search.close"
          @next="search.goToNext"
          @previous="search.goToPrevious"
        />

        <div v-if="!search.isOpen.value" class="chat-message-toolbar">
          <AppTooltip text="搜索会话内容（Ctrl+F）" side="left" :side-offset="3">
            <AppButton
              icon
              class="chat-search-trigger"
              variant="ghost"
              size="sm"
              type="button"
              aria-label="搜索会话内容"
              @click="search.open"
            >
              <span class="i-mingcute-search-line size-4" aria-hidden="true" />
            </AppButton>
          </AppTooltip>
        </div>

        <ChatMessageList
          ref="messageListRef"
          :messages="chat.state.messages"
          :editing-message-id="chat.state.editingMessageId"
          :is-busy="chat.state.isConnecting || chat.state.isReplying"
          :search-hit="searchHit"
          @edit-user="chat.handleEditUserMessage"
          @save-user="handleSaveUserMessage"
          @cancel-edit="chat.handleCancelEdit"
          @regenerate-assistant="handleRegenerateAssistantMessage"
          @switch-branch="handleSwitchBranch"
        />
      </template>
    </section>

    <SessionDamageNotice
      v-if="damagedEntryCount > 0"
      class="chat-input-topbar"
      :damaged-entry-count="damagedEntryCount"
    />

    <SubagentTaskCard
      class="chat-input-topbar"
      :tasks="subagentTasks.tasks.value"
      @cancel="subagentTasks.cancel"
      @dismiss="subagentTasks.dismiss"
    />

    <ContextPressureCard
      v-if="contextCompaction.shouldShow.value && contextCompaction.status.value"
      class="chat-input-topbar"
      :status="contextCompaction.status.value"
      :is-compacting="contextCompaction.isCompacting.value"
      @compact="contextCompaction.compact"
      @dismiss="contextCompaction.dismiss"
    />

    <MemoryPendingCard
      class="chat-input-topbar"
      :proposals="memoryPending.proposals.value"
      :notice="memoryPending.notice.value"
      @resolve="memoryPending.resolve"
    />

    <PermissionRequestCard
      class="chat-input-topbar"
      :requests="permissionRequests.requests.value"
      :is-submitting="permissionRequests.isSubmitting.value"
      @decide="permissionRequests.decide"
    />

    <ReviewResultStrip
      class="chat-input-topbar"
      :lanes="review.lanes"
      @retry-read="review.retryRead"
      @cancel="review.cancel"
      @dismiss="review.dismiss"
    />

    <TodoProgressCard
      v-if="todoProgress.visible.value"
      class="chat-input-topbar"
      :items="todoProgress.items.value"
      :total="todoProgress.total.value"
      :completed-count="todoProgress.completedCount.value"
      :is-clearing="todoProgress.isClearing.value"
      @clear-all="todoProgress.clearAll"
      @clear-completed="todoProgress.clearCompleted"
    />

    <ChatInputBox
      v-model="chat.state.input"
      :is-connecting="chat.state.isConnecting"
      :is-replying="chat.state.isReplying"
      :is-submitting-steer="chat.state.isSubmittingSteer"
      :is-enabled-web-search="chat.state.isEnabledWebSearch"
      :reasoning-effort="chat.state.reasoningEffort"
      :context-files="chat.state.contextFiles"
      :slash-commands="chat.state.slashCommands"
      :model-label="chat.currentModelLabel.value"
      :workspace-label="chat.workspaceLabel.value"
      @submit="handleSend"
      @toggle-web-search="chat.handleToggleWebSearch"
      @select-reasoning-effort="chat.handleSelectReasoningEffort"
      @add-context-files="chat.handleAddContextFiles"
      @drop-context-files="chat.handleDropContextFiles"
      @remove-context-file="chat.handleRemoveContextFile"
      @open-settings="chat.handleOpenSettings"
    />
  </main>
</template>

<style scoped lang="scss">
.chat-main {
  @apply flex min-h-0 flex-1 flex-col overflow-hidden py-1;
}

.chat-main-welcome {
  @apply h-full;
}

.chat-messages-section {
  @apply relative flex min-h-0 w-full flex-1 flex-col justify-between leading-relaxed;
}

.chat-messages-section-welcome {
  @apply mx-auto max-w-3xl justify-center gap-8 px-4 pb-6;
}

.chat-message-toolbar {
  @apply flex shrink-0 justify-end px-4 pb-1;
}

.chat-search-trigger {
  background: var(--surface-acrylic-strong);
}

.chat-input-topbar {
  // 宽度对齐输入框，紧贴其上方，并为辅助栏边缘保留操作空间。
  @apply mx-auto mb-2 max-w-3xl;

  width: calc(100% - 1rem);
}
</style>
