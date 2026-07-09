<script setup lang="ts">
import type { SelectedContextFile } from '@chaptale/ipc-contract';
import { formatFileSize } from '@chaptale/shared';

import AppButton from '@/components/AppButton/AppButton.vue';
import { cn } from '@/utils';

const props = defineProps<{
  files: SelectedContextFile[];
}>();

const emit = defineEmits<{
  remove: [path: string];
}>();
</script>

<template>
  <div v-if="props.files.length > 0" class="chat-context-files">
    <div v-for="file in props.files" :key="file.path" class="chat-context-file-card" :title="file.path">
      <img v-if="file.previewDataUrl" class="chat-context-file-thumb" :src="file.previewDataUrl" :alt="file.name" />
      <span
        v-else
        :class="cn('chat-context-file-icon', file.kind === 'image' ? 'i-mingcute-pic-line' : 'i-mingcute-file-line')"
        aria-hidden="true"
      />
      <span class="chat-context-file-meta">
        <span class="chat-context-file-name">{{ file.name }}</span>
        <span class="chat-context-file-size">{{ formatFileSize(file.size) }}</span>
      </span>
      <AppButton icon variant="ghost" size="xs" type="button" aria-label="移除" @click="emit('remove', file.path)">
        <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
      </AppButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
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
