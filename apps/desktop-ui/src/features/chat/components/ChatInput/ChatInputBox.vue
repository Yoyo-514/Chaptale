<script setup lang="ts">
import { ref } from 'vue';

import type { SlashCommand } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';

import { cn } from '@/utils';

import ChatContextFiles from './ChatContextFiles.vue';
import ChatInputStatusBar from './ChatInputStatusBar.vue';
import ChatInputToolbar from './ChatInputToolbar.vue';
import ChatPromptInput from './ChatPromptInput.vue';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
  /** steer IPC 提交期间锁定输入，避免重复发送。 */
  isSubmittingSteer: boolean;
  isEnabledWebSearch: boolean;
  contextFiles: ChatContextFile[];
  slashCommands: SlashCommand[];
  modelLabel: string;
  workspaceLabel: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  toggleWebSearch: [];
  addContextFiles: [];
  dropContextFiles: [files: File[]];
  removeContextFile: [path: string];
  openSettings: [section: 'workspace' | 'llm'];
  runReview: [];
}>();

const isDragOver = ref(false);
// dragenter/dragleave 会在子元素间反复触发，用计数器避免覆盖层闪烁。
let dragDepth = 0;

function hasFilePayload(event: DragEvent) {
  return Boolean(event.dataTransfer?.types.includes('Files'));
}

function handleDragEnter(event: DragEvent) {
  if (!hasFilePayload(event)) {
    return;
  }

  dragDepth += 1;
  isDragOver.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!hasFilePayload(event)) {
    return;
  }

  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);

  if (dragDepth === 0) {
    isDragOver.value = false;
  }
}

function handleDrop(event: DragEvent) {
  if (!hasFilePayload(event)) {
    return;
  }

  event.preventDefault();
  dragDepth = 0;
  isDragOver.value = false;

  const files = [...(event.dataTransfer?.files ?? [])];

  if (files.length > 0) {
    emit('dropContextFiles', files);
  }
}
</script>

<template>
  <section class="chat-input-section">
    <div
      :class="cn('chat-input-container', isDragOver && 'chat-input-container-dragover')"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <ChatContextFiles :files="props.contextFiles" @remove="emit('removeContextFile', $event)" />

      <ChatPromptInput
        :model-value="props.modelValue"
        :is-connecting="props.isConnecting"
        :is-replying="props.isReplying"
        :is-submitting-steer="props.isSubmittingSteer"
        :slash-commands="props.slashCommands"
        @update:model-value="emit('update:modelValue', $event)"
        @submit="emit('submit')"
      />

      <ChatInputToolbar
        :is-enabled-web-search="props.isEnabledWebSearch"
        :context-file-count="props.contextFiles.length"
        @toggle-web-search="emit('toggleWebSearch')"
        @add-context-files="emit('addContextFiles')"
        @run-review="emit('runReview')"
      />

      <div v-if="isDragOver" class="chat-drop-overlay">
        <span class="i-mingcute-upload-2-line" aria-hidden="true" />
        <span>松开以添加为本轮上下文</span>
      </div>
    </div>

    <ChatInputStatusBar
      :model-label="props.modelLabel"
      :workspace-label="props.workspaceLabel"
      @open-settings="emit('openSettings', $event)"
    />
  </section>
</template>

<style scoped lang="scss">
.chat-input-section {
  @apply mx-auto w-full md:w-3xl z-$z-content-raised shrink-0;
}

.chat-input-container {
  @apply relative flex flex-col gap-2 rounded-xl border-2 pb-10 shadow-$shadow-inset-highlight transition-colors duration-200;

  background: var(--input-background);
  border-color: var(--input-border);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.chat-input-container:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow), var(--shadow-inset-highlight);
}

.chat-input-container-dragover {
  border-color: var(--input-focus-border);
  border-style: dashed;
}

.chat-drop-overlay {
  @apply absolute inset-0 z-$z-local-overlay flex-center gap-2 rounded-xl text-sm font-medium pointer-events-none;

  background: var(--surface-muted);
  color: var(--foreground);
  opacity: 0.92;
}
</style>
