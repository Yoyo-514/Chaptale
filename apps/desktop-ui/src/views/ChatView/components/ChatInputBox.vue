<script setup lang="ts">
import { ref } from 'vue';

import { cn } from '../../../utils';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  toggleWebSearch: [];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function handleSubmit() {
  if (props.isReplying) {
    emit('submit');
    return;
  }

  if (props.isConnecting) {
    return;
  }

  if (props.modelValue.trim() === '') {
    inputRef.value?.focus();
    return;
  }

  emit('submit');
}
</script>

<template>
  <section class="chat-input-section">
    <div class="chat-input-container">
      <input
        ref="inputRef"
        :value="props.modelValue"
        class="chat-input-field"
        type="text"
        placeholder="描述你的创作需求..."
        :disabled="props.isConnecting"
        @input="handleInput"
        @keydown.enter="handleSubmit"
      />

      <div class="chat-bottom-toolbar">
        <button
          :class="cn('chat-websearch-button', props.isEnabledWebSearch && 'chat-websearch-button-active')"
          type="button"
          :aria-pressed="props.isEnabledWebSearch"
          :title="props.isEnabledWebSearch ? '关闭联网搜索' : '开启联网搜索'"
          @click="emit('toggleWebSearch')"
        >
          <span class="i-mingcute-earth-line" aria-hidden="true" />
          <span>{{ props.isEnabledWebSearch ? '联网' : '离线' }}</span>
        </button>
      </div>

      <div class="chat-send-button-wrapper">
        <button
          :class="cn('chat-send-button', props.isConnecting && !props.isReplying && 'chat-send-button-disabled')"
          type="button"
          @click="handleSubmit"
        >
          <span v-if="props.isConnecting" class="i-mingcute-loading-line animate-spin" aria-label="正在连接" />
          <span v-else-if="props.isReplying" class="i-mingcute-stop-line" aria-label="中断" />
          <span v-else class="i-mingcute-send-plane-line" aria-label="发送" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.chat-input-section {
  @apply mx-auto w-full md:w-3xl z-10 shrink-0;
}

.chat-input-container {
  @apply relative flex flex-col gap-2 rounded-xl border-2 pb-10 shadow-inset-highlight transition-colors duration-200;

  background: var(--input-background);
  border-color: var(--input-border);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.chat-input-container:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow), var(--shadow-inset-highlight);
}

.chat-input-field {
  @apply h-11 bg-transparent px-4 outline-none;

  color: var(--input-foreground);
}

.chat-input-field::placeholder {
  color: var(--input-placeholder);
}

.chat-bottom-toolbar {
  @apply absolute bottom-2 left-2 select-none;
}

.chat-websearch-button {
  @apply flex cursor-pointer items-center gap-1 rounded-md border-0 p-1 px-2 text-sm outline-none transition-colors duration-200;

  background: transparent;
  color: var(--muted-foreground);
}

.chat-websearch-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.chat-websearch-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.chat-websearch-button-active {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.chat-send-button-wrapper {
  @apply absolute bottom-2 right-2;
}

.chat-send-button {
  @apply flex-center cursor-pointer rounded-full p-1.5 shadow-soft transition-colors duration-200;

  background: var(--action-background);
  color: var(--action-foreground);
}

.chat-send-button:hover {
  background: var(--action-background-hover);
}

.chat-send-button-disabled {
  @apply pointer-events-none shadow-none;

  background: var(--muted);
  color: var(--muted-foreground);
}
</style>
