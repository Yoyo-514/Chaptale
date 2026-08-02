<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { SlashCommand } from '@chaptale/ipc-contract';

import type { AppTextareaExpose } from '@/components/AppTextarea';
import { AppTextarea } from '@/components/AppTextarea';
import { useAutosizeTextarea } from '@/composables';
import { cn } from '@/utils';

import ChatSlashCommandMenu from './ChatSlashCommandMenu.vue';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
  /** steer IPC 提交期间锁定输入，避免草稿与回滚状态发生竞态。 */
  isSubmittingSteer: boolean;
  slashCommands: SlashCommand[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
}>();

const textareaRef = ref<AppTextareaExpose | null>(null);
const selectedCommandIndex = ref(0);
const commandMenuDismissed = ref(false);
// 只有尚未出现参数空格的 `/prefix` 才驱动补全，避免输入命令参数时菜单重新弹出。
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
/** 只有初次连接或 steer IPC 提交期间锁定编辑器；回复重试期间仍允许排队 steer。 */
const isInputDisabled = computed(() => (props.isConnecting && !props.isReplying) || props.isSubmittingSteer);
/** 回复中有非空文本时主按钮发送 steer，否则保持中断语义。 */
const isSteerReady = computed(() => props.isReplying && props.modelValue.trim().length > 0);
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

/** 按输入状态提交普通消息、steer 或中断意图。 */
function handleSubmit() {
  if (isInputDisabled.value) {
    return;
  }

  if (props.isReplying) {
    emit('submit');
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
  // 菜单打开时优先消费方向键、Tab 和 Enter；其余 Enter 才按普通消息发送处理。
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
    :disabled="isInputDisabled"
    @update:model-value="handleInput"
    @keydown="handleKeydown"
  />

  <div class="chat-send-button-wrapper">
    <button
      :class="cn('chat-send-button', isInputDisabled && 'chat-send-button-disabled')"
      type="button"
      :disabled="isInputDisabled"
      @click="handleSubmit"
    >
      <span v-if="props.isSubmittingSteer" class="i-mingcute-loading-line animate-spin" aria-label="正在发送调整" />
      <span v-else-if="isSteerReady" class="i-mingcute-send-plane-line" aria-label="发送调整" />
      <span v-else-if="props.isReplying" class="i-mingcute-stop-line" aria-label="中断" />
      <span v-else-if="props.isConnecting" class="i-mingcute-loading-line animate-spin" aria-label="正在连接" />
      <span v-else class="i-mingcute-send-plane-line" aria-label="发送" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.chat-input-field {
  @apply min-h-11 max-h-32 overflow-y-hidden;

  box-sizing: border-box;

  color: var(--input-foreground);
  font-size: var(--chat-content-font-size, 1rem);
  line-height: var(--chat-content-line-height, 1.25);
}

.chat-input-field::placeholder {
  color: var(--input-placeholder);
}

.chat-send-button-wrapper {
  @apply absolute bottom-2 right-2;
}

.chat-send-button {
  @apply flex-center cursor-pointer rounded-full p-1.5 shadow-$shadow-soft transition-colors duration-200;

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
