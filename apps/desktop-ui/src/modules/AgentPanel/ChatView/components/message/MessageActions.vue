<script setup lang="ts">
import AppButton from '@/components/AppButton/AppButton.vue';

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
    <AppButton
      icon
      variant="ghost"
      size="sm"
      class="message-action-button"
      type="button"
      title="复制原文"
      @click="emit('copy')"
    >
      <span class="i-mingcute-copy-2-line size-4" aria-hidden="true" />
    </AppButton>
    <AppButton
      v-if="canEdit"
      icon
      variant="ghost"
      size="sm"
      class="message-action-button"
      type="button"
      title="编辑并重试"
      @click="emit('edit')"
    >
      <span class="i-mingcute-edit-2-line size-4" aria-hidden="true" />
    </AppButton>
    <AppButton
      v-if="canRegenerate"
      icon
      variant="ghost"
      size="sm"
      class="message-action-button"
      type="button"
      title="重新生成"
      @click="emit('regenerate')"
    >
      <span class="i-mingcute-refresh-2-line size-4" aria-hidden="true" />
    </AppButton>
  </div>
</template>

<style scoped lang="scss">
.message-actions {
  @apply flex items-center opacity-0 transition-opacity duration-150;
}

.message-action-button {
  @apply text-muted-foreground;
}
</style>
