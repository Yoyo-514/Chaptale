<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  content: string;
  editing?: boolean;
}>();

const emit = defineEmits<{
  save: [content: string];
  cancel: [];
}>();

const draft = ref(props.content);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

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
  <form v-if="editing" class="user-message-edit" @submit.prevent="save">
    <textarea
      ref="textareaRef"
      v-model="draft"
      class="user-message-editor"
      rows="3"
      @keydown.escape.prevent="emit('cancel')"
    />
    <div class="user-message-edit-actions">
      <button class="user-message-secondary-button" type="button" @click="emit('cancel')">取消</button>
      <button class="user-message-primary-button" type="submit">保存并重试</button>
    </div>
  </form>

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
  @apply min-h-10 resize-y rounded-xl border border-border-subtle bg-background px-3 py-2 text-foreground outline-none transition-colors duration-150;
}

.user-message-editor:focus {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow);
}

.user-message-edit-actions {
  @apply flex justify-end gap-2;
}

.user-message-secondary-button,
.user-message-primary-button {
  @apply rounded-md px-3 py-1.5 text-sm transition-colors duration-150;
}

.user-message-secondary-button {
  @apply text-muted-foreground hover:bg-surface-muted hover:text-foreground;
}

.user-message-primary-button {
  @apply bg-primary text-primary-foreground hover:bg-primary/90;
}
</style>
