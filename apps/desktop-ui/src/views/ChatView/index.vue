<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import MessageItem from '../../components/MessageItem/MessageItem.vue';
import { useSessionStore } from '../../stores/session';
import { cn } from '../../utils';
import ChatEmptyState from './components/ChatEmptyState.vue';
import ChatInputBox from './components/ChatInputBox.vue';
import SessionToolbar from './components/SessionToolbar.vue';

type ChatState = {
  messages: ChatMessage[];
  input: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
  error: string;
};

const sessionStore = useSessionStore();

const state = reactive<ChatState>({
  messages: [],
  input: '',
  isConnecting: false,
  isReplying: false,
  isEnabledWebSearch: true,
  error: ''
});

const mainRef = ref<HTMLElement | null>(null);
const activeRunId = ref<string>('');
const isWelcome = computed(() => state.messages.length === 0);
const recentSessions = computed(() =>
  sessionStore.sessions
    .filter(session => session.id !== sessionStore.currentSessionId)
    .filter(session => session.messageCount > 0 || session.lastMessagePreview || session.name)
    .slice(0, 2)
);

async function scrollToBottom() {
  await nextTick();
  mainRef.value?.scrollTo({
    top: mainRef.value.scrollHeight,
    behavior: 'smooth'
  });
}

async function handleSelectRecentSession(sessionId: string) {
  await sessionStore.selectSession(sessionId);
}

async function loadCurrentSessionMessages() {
  if (!window.chaptaleDesktop) {
    state.error = '当前界面需要在 Chaptale 桌面端中运行';
    return;
  }

  state.error = '';
  const messages = await sessionStore.getCurrentMessages().catch(error => {
    state.error = error instanceof Error ? error.message : String(error);
    return [];
  });
  state.messages = messages;
  await scrollToBottom();
}

onMounted(loadCurrentSessionMessages);

watch(
  () => sessionStore.currentSessionId,
  async (sessionId, previousSessionId) => {
    if (!sessionId || sessionId === previousSessionId) {
      return;
    }

    await loadCurrentSessionMessages();
  }
);

async function handleSend() {
  if (state.isConnecting) return;

  // 正在回复时再次点击按钮则中断流
  if (state.isReplying) {
    if (activeRunId.value) {
      await window.chaptaleDesktop?.agent.cancel(activeRunId.value);
    }
    return;
  }

  if (state.input.trim() === '') {
    return;
  }

  try {
    state.isConnecting = true;
    state.error = '';

    if (!window.chaptaleDesktop) {
      throw new Error('当前界面需要在 Chaptale 桌面端中运行');
    }

    const sessionId = await sessionStore.ensureActiveSession();
    const query = state.input.trim();

    state.messages.push({
      type: 'user',
      payload: {
        content: query
      }
    });

    state.input = '';
    state.isReplying = true;
    await scrollToBottom();

    const { runId } = await window.chaptaleDesktop.agent.stream(
      query,
      {
        onMessage: message => {
          const lastMessage = state.messages[state.messages.length - 1];

          // 合并不完全消息
          if (message.partial && lastMessage?.partial && 'content' in lastMessage.payload) {
            lastMessage.payload.content += message.payload.content;
            void scrollToBottom();
            return;
          }

          // 其他类型的消息
          state.messages.push(message);
          void scrollToBottom();
        },
        onDone: () => {
          activeRunId.value = '';
          state.isReplying = false;
          state.isConnecting = false;
          void sessionStore.loadSessions();
        },
        onError: message => {
          activeRunId.value = '';
          state.error = message;
          state.isReplying = false;
          state.isConnecting = false;
        }
      },
      sessionId
    );

    activeRunId.value = runId;
    state.isConnecting = false;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.isReplying = false;
    state.isConnecting = false;
  }
}
</script>

<template>
  <main ref="mainRef" :class="cn('chat-main', isWelcome && 'chat-main-welcome')">
    <div class="chat-workspace-header">
      <SessionToolbar />
    </div>

    <section :class="cn('chat-messages-section', isWelcome && 'chat-messages-section-welcome')">
      <ChatEmptyState v-if="isWelcome" :recent-sessions="recentSessions" @select-session="handleSelectRecentSession" />

      <div v-else class="chat-messages-list">
        <MessageItem v-for="(message, index) in state.messages" :key="index" :message="message" />
      </div>

      <div v-if="state.error" class="chat-error-message">
        {{ state.error }}
      </div>
    </section>

    <ChatInputBox
      v-model="state.input"
      :is-connecting="state.isConnecting"
      :is-replying="state.isReplying"
      :is-enabled-web-search="state.isEnabledWebSearch"
      @submit="handleSend"
    />
  </main>
</template>

<style scoped lang="scss">
.chat-main {
  @apply flex flex-1 flex-col overflow-y-auto pt-3 pb-28;
}

.chat-main-welcome {
  @apply h-full;
}

.chat-workspace-header {
  @apply mx-auto w-full px-4 pb-4 md:w-3xl;
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

.chat-error-message {
  @apply mt-4 rounded-xl border p-4 py-3 text-sm;

  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}
</style>
