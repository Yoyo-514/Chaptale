<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import MessageItem from '../components/MessageItem/MessageItem.vue';
import TitleBar from '../components/TitleBar/TitleBar.vue';
import { cn } from '../utils';

type AppState = {
  messages: ChatMessage[];
  input: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
  error: string;
};

const state = reactive<AppState>({
  messages: [],
  input: '',
  isConnecting: false,
  isReplying: false,
  isEnabledWebSearch: true,
  error: ''
});

const inputRef = ref<HTMLInputElement | null>(null);
const activeRunId = ref<string>('');
const isWelcome = computed(() => state.messages.length === 0);

onMounted(async () => {
  if (!window.chaptaleDesktop) {
    state.error = '当前界面需要在 Chaptale 桌面端中运行';
    return;
  }

  const messages = await window.chaptaleDesktop.agent.getHistory().catch(() => []);
  state.messages = messages;

  await nextTick();
  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'smooth'
  });
});

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
    inputRef.value?.focus();
    return;
  }

  try {
    state.isConnecting = true;
    state.error = '';

    if (!window.chaptaleDesktop) {
      throw new Error('当前界面需要在 Chaptale 桌面端中运行');
    }

    const query = state.input.trim();

    state.messages.push({
      type: 'user',
      payload: {
        content: query
      }
    });

    state.input = '';
    state.isReplying = true;

    const { runId } = await window.chaptaleDesktop.agent.stream(query, {
      onMessage: message => {
        const lastMessage = state.messages[state.messages.length - 1];

        // 合并不完全消息
        if (message.partial && lastMessage?.partial && 'content' in lastMessage.payload) {
          lastMessage.payload.content += message.payload.content;
          return;
        }

        // 其他类型的消息
        state.messages.push(message);
      },
      onDone: () => {
        activeRunId.value = '';
        state.isReplying = false;
        state.isConnecting = false;
      },
      onError: message => {
        activeRunId.value = '';
        state.error = message;
        state.isReplying = false;
        state.isConnecting = false;
      }
    });

    activeRunId.value = runId;
    state.isConnecting = false;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.isReplying = false;
    state.isConnecting = false;
  }
}
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <main :class="cn('app-main', isWelcome && 'app-main-welcome')">
      <section class="app-header">
        <h1 class="app-title">{{ isWelcome ? '开始构思你的故事' : 'Chaptale' }}</h1>
      </section>

      <section class="app-messages-section">
        <div class="app-messages-list">
          <MessageItem v-for="(message, index) in state.messages" :key="index" :message="message" />
        </div>
        <div v-if="state.error" class="app-error-message">{{ state.error }}</div>
      </section>

      <section :class="cn('app-input-section', isWelcome ? 'app-input-section-welcome' : 'app-input-section-fixed')">
        <div class="app-input-container">
          <input
            ref="inputRef"
            v-model="state.input"
            class="app-input-field"
            autofocus
            :disabled="state.isConnecting || state.isReplying"
            placeholder="输入灵感、设定或剧情片段"
            @keydown.enter="handleSend"
          />

          <div class="app-bottom-toolbar">
            <div :class="cn('app-websearch-button', state.isEnabledWebSearch && 'app-websearch-button-active')">
              <span class="i-lucide-globe" aria-hidden="true" />
              <span>联网搜索</span>
            </div>
          </div>

          <div class="app-send-button-wrapper">
            <div :class="cn('app-send-button', state.isConnecting && 'app-send-button-disabled')" @click="handleSend">
              <span v-if="state.isConnecting" class="i-lucide-loader-circle animate-spin" aria-label="正在连接" />
              <span v-else-if="state.isReplying" class="i-lucide-square" aria-label="中断" />
              <span v-else class="i-lucide-send-horizontal" aria-label="发送" />
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  @apply flex h-full flex-col overflow-hidden;
}

.app-main {
  @apply flex-1 overflow-y-auto pb-28;
}

.app-main-welcome {
  @apply flex h-full flex-col justify-center;
}

.app-header {
  @apply sticky left-0 top-0;
}

.app-title {
  @apply relative mx-auto bg-background p-4 text-3xl font-medium md:w-3xl;
}

.app-messages-section {
  @apply mx-auto flex w-full flex-col justify-between px-4 pb-6 leading-relaxed md:w-3xl;
}

.app-messages-list {
  @apply flex flex-1 flex-col gap-4;
}

.app-error-message {
  @apply mt-4 rounded bg-red-50 p-4 py-3 text-sm text-red-500;
}

.app-input-section {
  @apply w-full bg-background p-4 pt-0 md:w-3xl;
}

.app-input-section-welcome {
  @apply relative mx-auto;
}

.app-input-section-fixed {
  @apply fixed bottom-0 left-1/2 -translate-x-1/2;
}

.app-input-container {
  @apply relative flex flex-col gap-2 rounded-xl border-2 bg-background pb-10 transition-colors duration-200 focus-within:border-primary;
}

.app-input-field {
  @apply h-11 bg-transparent px-4 outline-none;
}

.app-bottom-toolbar {
  @apply absolute bottom-2 left-2 select-none;
}

.app-websearch-button {
  @apply flex cursor-not-allowed items-center gap-1 rounded-md p-1 px-2 text-sm transition-colors duration-200 hover:bg-gray-100;
}

.app-websearch-button-active {
  @apply bg-blue-100 text-blue-600 hover:bg-blue-100;
}

.app-send-button-wrapper {
  @apply absolute bottom-2 right-2;
}

.app-send-button {
  @apply flex-center cursor-pointer rounded-full bg-black p-1.5 text-white transition-colors duration-200;
}

.app-send-button-disabled {
  @apply pointer-events-none bg-neutral-500;
}
</style>
