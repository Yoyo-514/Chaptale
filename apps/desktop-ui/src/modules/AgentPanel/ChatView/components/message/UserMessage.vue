<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppTextarea } from '@/components/AppTextarea';

import type { AppTextareaExpose } from '@/components/AppTextarea';

const props = defineProps<{
  content: string;
  editing?: boolean;
}>();

const emit = defineEmits<{
  save: [content: string];
  cancel: [];
}>();

const draft = ref(props.content);
const textareaRef = ref<AppTextareaExpose | null>(null);

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
  <AppForm v-if="editing" class="user-message-edit" @submit="save">
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

  <p v-else class="user-message">{{ content }}</p>
</template>

<style scoped lang="scss">
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
