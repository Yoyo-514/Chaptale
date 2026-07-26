<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { MemoryPendingCard, useMemoryPending } from '@/features/memory-review';
import { TodoProgressCard, useTodoProgress } from '@/features/todo-progress';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/utils';

import ChatEmptyState from './components/ChatEmptyState.vue';
import ChatInputBox from './components/ChatInput/ChatInputBox.vue';
import ChatMessageList from './components/ChatMessageList.vue';
import ChatSearchBar from './components/ChatSearchBar.vue';
import ContextPressureCard from './components/ContextPressureCard.vue';
import PermissionRequestCard from './components/PermissionRequestCard.vue';
import ReviewResultCard from './components/ReviewResultCard.vue';
import SubagentTaskCard from './components/SubagentTaskCard.vue';
import { useChatController } from './composables/useChatController';
import { useChatSearch } from './composables/useChatSearch';
import { useContextCompaction } from './composables/useContextCompaction';
import { useContinuityReview } from './composables/useContinuityReview';
import { usePermissionRequests } from './composables/usePermissionRequests';
import { useSubagentTasks } from './composables/useSubagentTasks';

const chat = useChatController();
const sessionStore = useSessionStore();
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
const review = useContinuityReview(
  () => chat.state.input,
  () => chat.state.contextFiles.map(file => file.path)
);

/** 任务入口分发：后续任务型 persona 在此按 personaId 接入。 */
function handleRunTask(personaId: string) {
  if (personaId === 'continuity-reviewer') {
    void review.start();
  }
}

const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
const search = useChatSearch(() => chat.state.messages);
const searchHit = computed(() => (search.isOpen.value ? search.activeMatch.value : undefined));

// 每轮终态会刷新会话列表 updatedAt；据此重查 SDK 的“当前上下文”水位，而非累计 token。
watch(
  () => sessionStore.currentSession?.updatedAt,
  (updatedAt, previousUpdatedAt) => {
    if (updatedAt && updatedAt !== previousUpdatedAt) {
      void contextCompaction.refresh();
    }
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    search.open();
  }
}

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));
</script>

<template>
  <main :class="cn('chat-main', chat.isWelcome.value && 'chat-main-welcome')">
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

        <AppTooltip v-if="!search.isOpen.value" text="搜索会话内容（Ctrl+F）" side="left" :side-offset="3">
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

    <ReviewResultCard
      class="chat-input-topbar"
      :state="review.state"
      @cancel="review.cancel"
      @dismiss="review.dismiss"
    />

    <TodoProgressCard
      v-if="todoProgress.visible.value"
      class="chat-input-topbar"
      :items="todoProgress.items.value"
      :total="todoProgress.total.value"
      :completed-count="todoProgress.completedCount.value"
    />

    <ChatInputBox
      v-model="chat.state.input"
      :is-connecting="chat.state.isConnecting"
      :is-replying="chat.state.isReplying"
      :is-submitting-steer="chat.state.isSubmittingSteer"
      :is-enabled-web-search="chat.state.isEnabledWebSearch"
      :context-files="chat.state.contextFiles"
      :slash-commands="chat.state.slashCommands"
      :model-label="chat.currentModelLabel.value"
      :workspace-label="chat.workspaceLabel.value"
      @submit="handleSend"
      @toggle-web-search="chat.handleToggleWebSearch"
      @add-context-files="chat.handleAddContextFiles"
      @drop-context-files="chat.handleDropContextFiles"
      @remove-context-file="chat.handleRemoveContextFile"
      @open-settings="chat.handleOpenSettings"
      @run-task="handleRunTask"
    />
  </main>
</template>

<style scoped lang="scss">
.chat-main {
  @apply flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-4;
}

.chat-main-welcome {
  @apply h-full;
}

.chat-messages-section {
  @apply relative flex min-h-0 w-full flex-1 flex-col justify-between leading-relaxed;
}

.chat-messages-section-welcome {
  @apply mx-auto justify-center gap-8 px-4 pb-6 md:w-3xl;
}

.chat-search-trigger {
  @apply absolute right-4 top-0 z-$z-local-overlay;

  background: var(--surface-acrylic-strong);
}

.chat-input-topbar {
  // 宽度对齐输入框，紧贴其上方。
  @apply mx-auto mb-2 w-full md:w-3xl;
}
</style>
