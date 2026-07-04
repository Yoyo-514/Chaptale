<script setup lang="ts">
import MessageItem from '../../components/MessageItem/MessageItem.vue';
import { cn } from '../../utils';
import ChatEmptyState from './components/ChatEmptyState.vue';
import ChatInputBox from './components/ChatInputBox.vue';
import { useChatController } from './composables/useChatController';

const chat = useChatController();
</script>

<template>
  <main :ref="chat.setMainElement" :class="cn('chat-main', chat.isWelcome.value && 'chat-main-welcome')">
    <section :class="cn('chat-messages-section', chat.isWelcome.value && 'chat-messages-section-welcome')">
      <ChatEmptyState
        v-if="chat.isWelcome.value"
        :recent-sessions="chat.recentSessions.value"
        @select-session="chat.handleSelectRecentSession"
      />

      <div v-else class="chat-messages-list">
        <MessageItem v-for="(message, index) in chat.state.messages" :key="index" :message="message" />
      </div>
    </section>

    <ChatInputBox
      v-model="chat.state.input"
      :is-connecting="chat.state.isConnecting"
      :is-replying="chat.state.isReplying"
      :is-enabled-web-search="chat.state.isEnabledWebSearch"
      @submit="chat.handleSend"
    />
  </main>
</template>

<style scoped lang="scss">
.chat-main {
  @apply flex flex-1 flex-col overflow-y-auto pt-3 pb-2;
}

.chat-main-welcome {
  @apply h-full;
}

.chat-messages-section {
  @apply mx-auto flex w-full flex-1 flex-col justify-between px-4 pb-6 leading-relaxed md:w-3xl;
}

.chat-messages-section-welcome {
  @apply justify-center gap-8;
}

.chat-messages-list {
  @apply flex flex-1 flex-col gap-4;
}
</style>
