<script setup lang="ts">
import { computed } from 'vue';

import type { ChatContextFile } from '@chaptale/shared';
import { formatFileSize } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppImagePreview, type AppImagePreviewItem } from '@/components/AppImagePreview';
import { cn } from '@/utils';
import { readImageBlob } from '../../utils/image-blob';

const props = withDefaults(
  defineProps<{
    files: ChatContextFile[];
    removable?: boolean;
    placement?: 'input' | 'message';
    showPath?: boolean;
  }>(),
  {
    removable: true,
    placement: 'input',
    showPath: true
  }
);

const emit = defineEmits<{
  remove: [path: string];
}>();

const previewFiles = computed(() =>
  props.files.filter(file => file.kind === 'image' && file.previewDataUrl && file.mimeType)
);
const fileCards = computed(() => {
  const previewPaths = new Set(previewFiles.value.map(file => file.path));
  return props.files.filter(file => !previewPaths.has(file.path));
});
const previewItems = computed<AppImagePreviewItem[]>(() =>
  previewFiles.value.map(file => ({
    id: file.path,
    alt: file.name,
    thumbnailSrc: file.previewDataUrl!,
    loadOriginal: () => readImageBlob({ type: 'context-file', path: file.path })
  }))
);

function getSkippedLabel(file: ChatContextFile) {
  const labels: Record<NonNullable<ChatContextFile['skippedReason']>, string> = {
    'file-too-large': '文件过大，未发送',
    'image-too-large': '图片超过 20 MB，未发送',
    'file-unavailable': '文件无法读取，未发送'
  };

  return file.skippedReason ? labels[file.skippedReason] : '';
}
</script>

<template>
  <div
    v-if="props.files.length > 0"
    :class="cn('chat-context-attachments', `chat-context-attachments-${props.placement}`)"
  >
    <AppImagePreview :items="previewItems" :removable="props.removable" @remove="emit('remove', $event)" />

    <div
      v-if="fileCards.length > 0"
      :class="cn('chat-context-files', props.placement === 'message' && 'chat-context-files-message')"
    >
      <div
        v-for="file in fileCards"
        :key="file.path"
        class="chat-context-file-card"
        :title="props.showPath ? file.path : file.name"
      >
        <img v-if="file.previewDataUrl" class="chat-context-file-thumb" :src="file.previewDataUrl" :alt="file.name" />
        <span
          v-else
          :class="cn('chat-context-file-icon', file.kind === 'image' ? 'i-mingcute-pic-line' : 'i-mingcute-file-line')"
          aria-hidden="true"
        />
        <span class="chat-context-file-meta">
          <span class="chat-context-file-name">{{ file.name }}</span>
          <span class="chat-context-file-size">
            {{ getSkippedLabel(file) || formatFileSize(file.size) }}
          </span>
        </span>
        <AppButton
          v-if="props.removable"
          icon
          variant="ghost"
          size="xs"
          type="button"
          aria-label="移除"
          @click="emit('remove', file.path)"
        >
          <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-context-attachments {
  @apply flex flex-col gap-2;
}

.chat-context-attachments-input {
  @apply px-3 pt-3;
}

.chat-context-attachments-message {
  @apply items-end;
}

.chat-context-attachments-message :deep(.app-image-thumbnail-grid) {
  @apply justify-end;
}

.chat-context-files {
  @apply flex flex-wrap gap-2;
}

.chat-context-files-message {
  @apply justify-end p-0;
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
  @apply mx-2 size-5 shrink-0;
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
</style>
