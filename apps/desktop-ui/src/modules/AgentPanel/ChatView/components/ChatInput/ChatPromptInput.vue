<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

import { cn } from '@/utils';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const maxVisibleRows = 5;

function getMaxTextareaHeight(textarea: HTMLTextAreaElement) {
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;

  return lineHeight * maxVisibleRows + paddingTop + paddingBottom;
}

function resizeTextarea() {
  const textarea = textareaRef.value;

  if (!textarea) {
    return;
  }

  const maxHeight = getMaxTextareaHeight(textarea);
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  resizeTextarea();
}

watch(
  () => props.modelValue,
  async () => {
    await nextTick();
    resizeTextarea();
  }
);

onMounted(() => {
  resizeTextarea();
});

function handleSubmit() {
  if (props.isReplying) {
    emit('submit');
    return;
  }

  if (props.isConnecting) {
    return;
  }

  if (props.modelValue.trim() === '') {
    textareaRef.value?.focus();
    return;
  }

  emit('submit');
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }

  event.preventDefault();
  handleSubmit();
}
</script>

<template>
  <textarea
    ref="textareaRef"
    :value="props.modelValue"
    class="chat-input-field"
    rows="1"
    placeholder="描述你的创作需求..."
    :disabled="props.isConnecting"
    @input="handleInput"
    @keydown="handleKeydown"
  />

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
</template>

<style scoped lang="scss">
.chat-input-field {
  @apply min-h-11 max-h-32 resize-none overflow-y-hidden bg-transparent px-4 py-3 leading-5 outline-none;

  box-sizing: border-box;

  color: var(--input-foreground);
}

.chat-input-field::placeholder {
  color: var(--input-placeholder);
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
