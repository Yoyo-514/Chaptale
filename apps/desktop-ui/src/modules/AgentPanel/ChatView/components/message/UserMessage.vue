<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppImagePreview, type AppImagePreviewItem } from '@/components/AppImagePreview';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppTextarea } from '@/components/AppTextarea';
import type { ChatContextFile, ChatImageAttachment, ChatImageSource } from '@chaptale/shared';

import type { AppTextareaExpose } from '@/components/AppTextarea';
import ChatContextFiles from '../ChatInput/ChatContextFiles.vue';

const props = defineProps<{
  content: string;
  contextFiles?: ChatContextFile[];
  images?: ChatImageAttachment[];
  editing?: boolean;
}>();

const emit = defineEmits<{
  save: [content: string];
  cancel: [];
}>();

const draft = ref(props.content);
const textareaRef = ref<AppTextareaExpose | null>(null);
const imagePreviewItems = computed<AppImagePreviewItem[]>(() =>
  (props.images ?? []).map((image, index) => ({
    id: image.id,
    alt: `用户上传的图片 ${index + 1}`,
    thumbnailSrc: image.thumbnailDataUrl,
    loadOriginal: () => loadOriginalImage(image)
  }))
);

async function loadOriginalImage(image: ChatImageAttachment) {
  if (!image.source) {
    return fetch(image.thumbnailDataUrl).then(response => response.blob());
  }

  // props 里的 source 是 Vue 响应式 Proxy，直接传给 IPC 会因结构化克隆失败
  // 抛 "An object could not be cloned"，必须先展开成纯对象。
  const payload: ChatImageSource =
    image.source.type === 'session-entry'
      ? {
          type: 'session-entry',
          sessionId: image.source.sessionId,
          entryId: image.source.entryId,
          blockIndex: image.source.blockIndex
        }
      : { type: 'context-file', path: image.source.path };
  const result = await window.chaptaleDesktop?.session.readImage(payload);

  if (!result) {
    throw new Error('桌面图片服务不可用');
  }

  return new Blob([new Uint8Array(result.data)], { type: result.mimeType });
}

watch(
  () => props.content,
  content => {
    draft.value = content;
  }
);

watch(
  () => props.editing,
  async editing => {
    if (!editing) {
      draft.value = props.content;
      return;
    }

    await nextTick();
    textareaRef.value?.focus();
    textareaRef.value?.select();
  }
);

function save() {
  const content = draft.value.trim();

  if (!content) {
    textareaRef.value?.focus();
    return;
  }

  emit('save', content);
}
</script>

<template>
  <div v-if="imagePreviewItems.length" class="user-message-images">
    <AppImagePreview variant="large" :items="imagePreviewItems" />
  </div>

  <AppForm v-if="editing" class="user-message-edit" @submit="save">
    <ChatContextFiles :files="props.contextFiles ?? []" :removable="false" placement="message" :show-path="false" />
    <AppTextarea
      ref="textareaRef"
      v-model="draft"
      class="user-message-editor"
      :rows="3"
      size="md"
      resize="vertical"
      @keydown.escape.prevent="emit('cancel')"
    />
    <AppFormActions>
      <AppButton type="button" @click="emit('cancel')">取消</AppButton>
      <AppButton variant="primary" type="submit">保存并重试</AppButton>
    </AppFormActions>
  </AppForm>

  <div v-else class="user-message-display">
    <ChatContextFiles :files="props.contextFiles ?? []" :removable="false" placement="message" :show-path="false" />
    <p v-if="content" class="user-message">{{ content }}</p>
  </div>
</template>

<style scoped lang="scss">
.user-message-images {
  @apply flex w-full justify-end;
}

.user-message-images :deep(.app-image-gallery) {
  @apply justify-end;
}

.user-message-display {
  @apply flex w-full flex-col items-end gap-2;
}

.user-message {
  @apply w-fit max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground shadow-inset-highlight;

  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.user-message-edit {
  @apply flex w-full max-w-[88%] flex-col gap-2 rounded-2xl border border-primary bg-surface-acrylic p-2 shadow-inset-highlight;
}

.user-message-editor {
  @apply min-h-10 rounded-xl;

  background: var(--background);
  border-color: var(--border-subtle);
}

.user-message-editor:focus {
  border-color: var(--input-focus-border);
}
</style>
