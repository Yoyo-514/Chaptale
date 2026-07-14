<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppImagePreview, type AppImagePreviewItem } from '@/components/AppImagePreview';
import { AppTextarea } from '@/components/AppTextarea';
import type { ChatContextFile, ChatImageAttachment, ChatSkillInvocation } from '@chaptale/shared';

import type { AppTextareaExpose } from '@/components/AppTextarea';
import ChatContextFiles from '../ChatInput/ChatContextFiles.vue';
import { readImageBlob } from '../../utils/image-blob';

const props = defineProps<{
  content: string;
  editableContent: string;
  skillInvocation?: ChatSkillInvocation;
  contextFiles?: ChatContextFile[];
  images?: ChatImageAttachment[];
  editing?: boolean;
}>();

const emit = defineEmits<{
  save: [content: string];
  cancel: [];
}>();

const draft = ref(props.editableContent);
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

  return readImageBlob(image.source);
}

watch(
  () => props.editableContent,
  content => {
    draft.value = content;
  }
);

watch(
  () => props.editing,
  async editing => {
    if (!editing) {
      draft.value = props.editableContent;
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
    <p v-if="props.skillInvocation || content" class="user-message">
      <span v-if="props.skillInvocation" class="user-message-skill">{{ props.skillInvocation.name }}</span>
      <span v-if="content">{{ content }}</span>
    </p>
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
  @apply flex w-fit max-w-[80%] items-start gap-2 rounded-2xl bg-primary px-4 py-2 text-primary-foreground shadow-inset-highlight;

  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.user-message-skill {
  @apply shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold;

  background: var(--accent);
  color: var(--accent-foreground);
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
