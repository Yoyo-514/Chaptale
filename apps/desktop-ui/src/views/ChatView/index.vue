<script setup lang="ts">
import { nextTick, ref } from 'vue';

import { cn } from '../../utils';
import ChatEmptyState from './components/ChatEmptyState.vue';
import ChatInputBox from './components/ChatInputBox.vue';
import ChatMessageList from './components/ChatMessageList.vue';
import { useChatController } from './composables/useChatController';

const chat = useChatController();
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);

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
</script>

<template>
  <main :class="cn('chat-main', chat.isWelcome.value && 'chat-main-welcome')">
    <section :class="cn('chat-messages-section', chat.isWelcome.value && 'chat-messages-section-welcome')">
      <ChatEmptyState
        v-if="chat.isWelcome.value"
        :recent-sessions="chat.recentSessions.value"
        @select-session="chat.handleSelectRecentSession"
      />

      <ChatMessageList
        v-else
        ref="messageListRef"
        :messages="chat.state.messages"
        :editing-message-id="chat.state.editingMessageId"
        :is-busy="chat.state.isConnecting || chat.state.isReplying"
        @edit-user="chat.handleEditUserMessage"
        @save-user="handleSaveUserMessage"
        @cancel-edit="chat.handleCancelEdit"
        @regenerate-assistant="handleRegenerateAssistantMessage"
        @switch-branch="handleSwitchBranch"
      />
    </section>

    <ChatInputBox
      v-model="chat.state.input"
      :is-connecting="chat.state.isConnecting"
      :is-replying="chat.state.isReplying"
      :is-enabled-web-search="chat.state.isEnabledWebSearch"
      @submit="handleSend"
    />
  </main>
</template>

<style scoped lang="scss">
.chat-main {
  @apply flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-6;
}

.chat-main-welcome {
  @apply h-full;
}

.chat-messages-section {
  @apply flex min-h-0 w-full flex-1 flex-col justify-between leading-relaxed;
}

.chat-messages-section-welcome {
  @apply mx-auto justify-center gap-8 px-4 pb-6 md:w-3xl;
}
</style>
