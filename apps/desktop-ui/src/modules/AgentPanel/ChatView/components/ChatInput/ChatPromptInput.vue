<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { AppTextareaExpose } from '@/components/AppTextarea';
import { AppTextarea } from '@/components/AppTextarea';
import { useAutosizeTextarea } from '@/composables';
import { cn } from '@/utils';
import type { SlashCommand } from '@chaptale/ipc-contract';
import ChatSlashCommandMenu from './ChatSlashCommandMenu.vue';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
  slashCommands: SlashCommand[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
}>();

const textareaRef = ref<AppTextareaExpose | null>(null);
const selectedCommandIndex = ref(0);
const commandMenuDismissed = ref(false);
const slashPrefix = computed(() => {
  if (!props.modelValue.startsWith('/')) {
    return undefined;
  }

  const value = props.modelValue.slice(1);
  return /\s/.test(value) ? undefined : value.toLowerCase();
});
const filteredSlashCommands = computed(() => {
  if (slashPrefix.value === undefined || commandMenuDismissed.value) {
    return [];
  }

  return props.slashCommands
    .filter(command => {
      const query = slashPrefix.value ?? '';
      return command.name.toLowerCase().includes(query) || command.description.toLowerCase().includes(query);
    })
    .slice(0, 8);
});
const isCommandMenuOpen = computed(() => filteredSlashCommands.value.length > 0);
const { resize: resizeTextarea } = useAutosizeTextarea(() => textareaRef.value?.getElement(), {
  maxRows: 5,
  value: () => props.modelValue
});

watch(
  () => props.modelValue,
  () => {
    selectedCommandIndex.value = 0;
    commandMenuDismissed.value = false;
  }
);

function handleInput(value: string) {
  emit('update:modelValue', value);
  resizeTextarea();
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
    textareaRef.value?.focus();
    return;
  }

  emit('submit');
}

async function completeCommand(command: SlashCommand) {
  emit('update:modelValue', `/${command.name} `);
  await nextTick();
  resizeTextarea();
  textareaRef.value?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (isCommandMenuOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const count = filteredSlashCommands.value.length;
      selectedCommandIndex.value = (selectedCommandIndex.value + direction + count) % count;
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      commandMenuDismissed.value = true;
      return;
    }

    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      const command = filteredSlashCommands.value[selectedCommandIndex.value];

      if (command) {
        event.preventDefault();
        void completeCommand(command);
      }
      return;
    }
  }

  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }

  event.preventDefault();
  handleSubmit();
}
</script>

<template>
  <ChatSlashCommandMenu
    v-if="isCommandMenuOpen"
    :commands="filteredSlashCommands"
    :selected-index="selectedCommandIndex"
    @select="completeCommand"
  />

  <AppTextarea
    ref="textareaRef"
    :model-value="props.modelValue"
    class="chat-input-field"
    :rows="1"
    size="lg"
    resize="none"
    variant="plain"
    placeholder="描述你的创作需求..."
    :disabled="props.isConnecting"
    @update:model-value="handleInput"
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
  @apply min-h-11 max-h-32 overflow-y-hidden;

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
