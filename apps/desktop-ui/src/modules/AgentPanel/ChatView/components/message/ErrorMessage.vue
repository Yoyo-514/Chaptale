<script setup lang="ts">
defineProps<{
  title?: string;
  content: string;
}>();
</script>

<template>
  <article class="error-message-card">
    <div class="error-message-header">
      <span class="i-mingcute-warning-line error-message-icon" aria-hidden="true" />
      <span>{{ title || '操作失败' }}</span>
    </div>
    <p class="error-message-content">{{ content }}</p>
  </article>
</template>

<style scoped lang="scss">
.error-message-card {
  @apply max-w-full rounded-xl border border-border-subtle bg-surface-acrylic px-4 py-3 shadow-$shadow-inset-highlight;
}

.error-message-header {
  @apply flex items-center gap-2 font-medium;

  color: var(--destructive);
}

.error-message-icon {
  @apply shrink-0;
}

.error-message-content {
  @apply mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground;
}
</style>
