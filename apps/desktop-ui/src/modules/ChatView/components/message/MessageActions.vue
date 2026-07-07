<script setup lang="ts">
defineProps<{
  canEdit?: boolean;
  canRegenerate?: boolean;
}>();

const emit = defineEmits<{
  copy: [];
  edit: [];
  regenerate: [];
}>();
</script>

<template>
  <div class="message-actions" aria-label="消息操作">
    <button class="message-action-button" type="button" title="复制原文" @click="emit('copy')">
      <span class="i-mingcute-copy-2-line" aria-hidden="true" />
    </button>
    <button v-if="canEdit" class="message-action-button" type="button" title="编辑并重试" @click="emit('edit')">
      <span class="i-mingcute-edit-2-line" aria-hidden="true" />
    </button>
    <button
      v-if="canRegenerate"
      class="message-action-button"
      type="button"
      title="重新生成"
      @click="emit('regenerate')"
    >
      <span class="i-mingcute-refresh-2-line" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.message-actions {
  @apply flex items-center gap-1 opacity-0 transition-opacity duration-150;
}

.message-action-button {
  @apply flex-center rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-surface-muted hover:text-foreground;
}
</style>
