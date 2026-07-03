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
              <span class="i-mingcute-earth-line" aria-hidden="true" />
              <span>联网搜索</span>
            </div>
          </div>

          <div class="app-send-button-wrapper">
            <div :class="cn('app-send-button', state.isConnecting && 'app-send-button-disabled')" @click="handleSend">
              <span v-if="state.isConnecting" class="i-mingcute-loading-line animate-spin" aria-label="正在连接" />
              <span v-else-if="state.isReplying" class="i-mingcute-stop-line" aria-label="中断" />
              <span v-else class="i-mingcute-send-plane-line" aria-label="发送" />
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
  @apply flex-1 overflow-y-auto pt-6 pb-28;
}

.app-main-welcome {
  @apply flex h-full flex-col justify-center;
}

.app-messages-section {
  @apply mx-auto flex w-full flex-col justify-between px-4 pb-6 leading-relaxed md:w-3xl;
}

.app-messages-list {
  @apply flex flex-1 flex-col gap-4;
}

.app-error-message {
  @apply mt-4 rounded-xl border border-destructive bg-destructive-background p-4 py-3 text-sm text-destructive-background-foreground;
}

.app-input-section {
  @apply w-full p-4 pt-0 md:w-3xl;
}

.app-input-section-welcome {
  @apply relative mx-auto;
}

.app-input-section-fixed {
  @apply fixed bottom-0 left-1/2 -translate-x-1/2;
}

.app-input-container {
  @apply relative flex flex-col gap-2 rounded-xl border-2 border-input-border bg-input-background pb-10 shadow-inset-highlight transition-colors duration-200 focus-within:border-input-focus;

  backdrop-filter: var(--blur-acrylic-subtle);
}

.app-input-container:focus-within {
  box-shadow: var(--input-focus-shadow), var(--shadow-inset-highlight);
}

.app-input-field {
  @apply h-11 bg-transparent px-4 text-input-foreground outline-none placeholder:text-input-placeholder;
}

.app-bottom-toolbar {
  @apply absolute bottom-2 left-2 select-none;
}

.app-websearch-button {
  @apply flex cursor-not-allowed items-center gap-1 rounded-md p-1 px-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-surface-muted;
}

.app-websearch-button-active {
  @apply bg-secondary text-secondary-foreground hover:bg-primary-hover;
}

.app-send-button-wrapper {
  @apply absolute bottom-2 right-2;
}

.app-send-button {
  @apply flex-center cursor-pointer rounded-full bg-action p-1.5 text-action-foreground shadow-soft transition-colors duration-200 hover:bg-action-hover;
}

.app-send-button-disabled {
  @apply pointer-events-none bg-muted text-muted-foreground shadow-none;
}
</style>
