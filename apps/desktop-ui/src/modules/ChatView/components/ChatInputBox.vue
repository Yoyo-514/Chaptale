<script setup lang="ts">
import { ref } from 'vue';

import type { SelectedContextFile } from '@chaptale/ipc-contract';
import { formatFileSize } from '@chaptale/shared';
import AppTooltip from '../../../components/AppTooltip/AppTooltip.vue';
import { cn } from '../../../utils';

const props = defineProps<{
  modelValue: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
  contextFiles: SelectedContextFile[];
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
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
// dragenter/dragleave 会在子元素间反复触发，用计数器避免覆盖层闪烁。
let dragDepth = 0;

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
      <div v-if="props.contextFiles.length > 0" class="chat-context-files">
        <div v-for="file in props.contextFiles" :key="file.path" class="chat-context-file-card" :title="file.path">
          <img v-if="file.previewDataUrl" class="chat-context-file-thumb" :src="file.previewDataUrl" :alt="file.name" />
          <span
            v-else
            :class="
              cn('chat-context-file-icon', file.kind === 'image' ? 'i-mingcute-pic-line' : 'i-mingcute-file-line')
            "
            aria-hidden="true"
          />
          <span class="chat-context-file-meta">
            <span class="chat-context-file-name">{{ file.name }}</span>
            <span class="chat-context-file-size">{{ formatFileSize(file.size) }}</span>
          </span>
          <button type="button" class="chat-context-file-remove" @click="emit('removeContextFile', file.path)">
            <span class="i-mingcute-close-line" aria-label="移除" />
          </button>
        </div>
      </div>

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
        <AppTooltip :text="props.isEnabledWebSearch ? '关闭联网搜索' : '开启联网搜索'" side="bottom">
          <button
            :class="cn('chat-tool-button', props.isEnabledWebSearch && 'chat-tool-button-active')"
            type="button"
            :aria-pressed="props.isEnabledWebSearch"
            @click="emit('toggleWebSearch')"
          >
            <span class="i-mingcute-earth-line" aria-hidden="true" />
            <span>{{ props.isEnabledWebSearch ? '联网' : '离线' }}</span>
          </button>
        </AppTooltip>
        <AppTooltip text="添加本轮上下文文件（也可直接拖入）" side="bottom">
          <button class="chat-tool-button" type="button" @click="emit('addContextFiles')">
            <span class="i-mingcute-attachment-line" aria-hidden="true" />
            <span>{{ props.contextFiles.length > 0 ? `${props.contextFiles.length} 个文件` : '添加文件' }}</span>
          </button>
        </AppTooltip>
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

      <div v-if="isDragOver" class="chat-drop-overlay">
        <span class="i-mingcute-upload-2-line" aria-hidden="true" />
        <span>松开以添加为本轮上下文</span>
      </div>
    </div>

    <div class="chat-status-bar">
      <AppTooltip text="打开模型设置" side="bottom">
        <button class="chat-status-item" type="button" aria-label="打开模型设置" @click="emit('openSettings', 'llm')">
          <span class="i-mingcute-ai-line" aria-hidden="true" />
          <span class="chat-status-text">{{ props.modelLabel }}</span>
        </button>
      </AppTooltip>
      <span class="chat-status-divider" aria-hidden="true" />
      <AppTooltip text="打开工作区设置" side="bottom">
        <button
          class="chat-status-item"
          type="button"
          aria-label="打开工作区设置"
          @click="emit('openSettings', 'workspace')"
        >
          <span class="i-mingcute-folder-line" aria-hidden="true" />
          <span class="chat-status-text">{{ props.workspaceLabel }}</span>
        </button>
      </AppTooltip>
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

.chat-input-container-dragover {
  border-color: var(--input-focus-border);
  border-style: dashed;
}

.chat-drop-overlay {
  @apply absolute inset-0 z-10 flex-center gap-2 rounded-xl text-sm font-medium pointer-events-none;

  background: var(--surface-muted);
  color: var(--foreground);
  opacity: 0.92;
}

.chat-input-field {
  @apply h-11 bg-transparent px-4 outline-none;

  color: var(--input-foreground);
}

.chat-input-field::placeholder {
  color: var(--input-placeholder);
}

.chat-context-files {
  @apply flex flex-wrap gap-2 px-3 pt-3;
}

.chat-context-file-card {
  @apply flex max-w-64 items-center gap-2 rounded-lg p-1.5 pr-2 text-xs;

  background: var(--surface-muted);
  color: var(--muted-foreground);
}

.chat-context-file-thumb {
  @apply size-9 shrink-0 rounded-md object-cover;
}

.chat-context-file-icon {
  @apply size-5 shrink-0 mx-2;
}

.chat-context-file-meta {
  @apply flex min-w-0 flex-col;
}

.chat-context-file-name {
  @apply truncate font-medium;

  color: var(--foreground);
}

.chat-context-file-size {
  @apply text-[11px];
}

.chat-context-file-remove {
  @apply flex-center cursor-pointer rounded border-0 bg-transparent p-0.5;

  color: var(--muted-foreground);
}

.chat-context-file-remove:hover {
  color: var(--foreground);
}

.chat-bottom-toolbar {
  @apply absolute bottom-2 left-2 flex select-none items-center gap-1;
}

.chat-tool-button {
  @apply flex cursor-pointer items-center gap-1 rounded-md border-0 p-1 px-2 text-sm outline-none transition-colors duration-200;

  background: transparent;
  color: var(--muted-foreground);
}

.chat-tool-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.chat-tool-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.chat-tool-button-active {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.chat-status-bar {
  @apply mt-1.5 flex select-none items-center gap-1 px-2 text-xs;

  color: var(--muted-foreground);
}

.chat-status-item {
  @apply flex min-w-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent p-0.5 px-1.5 text-xs outline-none transition-colors duration-200;

  color: var(--muted-foreground);
}

.chat-status-item:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.chat-status-item:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.chat-status-text {
  @apply max-w-72 truncate;
}

.chat-status-divider {
  @apply h-3 w-px shrink-0;

  background: var(--input-border);
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
