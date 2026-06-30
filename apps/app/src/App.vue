<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import MessageItem from './components/MessageItem/index.vue';
import { ssePost } from './lib/sse';
import { cn } from './lib/utils';

import styles from './App.module.scss';

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
const abortController = ref<AbortController | null>(null);
const isWelcome = computed(() => state.messages.length === 0);

onMounted(async () => {
  const response = await fetch('/api/history');
  const messages = await response.json().catch(() => []);
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
    abortController.value?.abort();
    return;
  }

  if (state.input.trim() === '') {
    inputRef.value?.focus();
    return;
  }

  try {
    state.isConnecting = true;
    state.error = '';

    abortController.value = new AbortController();

    const stream = await ssePost<ChatMessage>('/api/sse', {
      signal: abortController.value.signal,
      params: {
        query: state.input.trim()
        // websearch: state.isEnabledWebSearch
      }
    });

    state.messages.push({
      type: 'user',
      payload: {
        content: state.input
      }
    });

    state.input = '';
    state.isReplying = true;
    state.isConnecting = false;

    // 接收 SSE 消息
    for await (const message of stream) {
      const lastMessage = state.messages[state.messages.length - 1];

      // 合并不完全消息
      if (message.partial && lastMessage?.partial && 'content' in lastMessage.payload) {
        lastMessage.payload.content += message.payload.content;
        continue;
      }

      // 其他类型的消息
      state.messages.push(message);
    }

    state.isReplying = false;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.isReplying = false;
    state.isConnecting = false;
  }
}
</script>

<template>
  <main :class="cn(styles.main, isWelcome && styles.mainWelcome)">
    <section :class="styles.header">
      <h1 :class="styles.title">{{ isWelcome ? '开始构思你的故事' : 'Chaptale' }}</h1>
    </section>

    <section :class="styles.messagesSection">
      <div :class="styles.messagesList">
        <MessageItem v-for="(message, index) in state.messages" :key="index" :message="message" />
      </div>
      <div v-if="state.error" :class="styles.errorMessage">{{ state.error }}</div>
    </section>

    <section :class="cn(styles.inputSection, isWelcome ? styles.inputSectionWelcome : styles.inputSectionFixed)">
      <div :class="styles.inputContainer">
        <input
          ref="inputRef"
          v-model="state.input"
          :class="styles.inputField"
          autofocus
          :disabled="state.isConnecting || state.isReplying"
          placeholder="输入灵感、设定或剧情片段"
          @keydown.enter="handleSend"
        />

        <div :class="styles.bottomToolbar">
          <div :class="cn(styles.websearchButton, state.isEnabledWebSearch && styles.websearchButtonActive)">
            <span aria-hidden="true">◎</span>
            <span>联网搜索</span>
          </div>
        </div>

        <div :class="styles.sendButtonWrapper">
          <div :class="cn(styles.sendButton, state.isConnecting && styles.sendButtonDisabled)" @click="handleSend">
            <span v-if="state.isConnecting" :class="styles.iconSpin" aria-label="正在连接">◎</span>
            <span v-else-if="state.isReplying" aria-label="中断">■</span>
            <span v-else :class="styles.iconRotate" aria-label="发送">➜</span>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
