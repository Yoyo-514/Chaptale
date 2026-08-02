<script setup lang="ts">
import { RouterView } from 'vue-router';

import { ChatToolbar } from '@/features/chat';
</script>

<template>
  <section class="chat-layout" aria-label="Agent 面板">
    <header class="chat-layout-toolbar">
      <ChatToolbar />
    </header>

    <div class="chat-layout-content">
      <RouterView />
    </div>
  </section>
</template>

<style scoped lang="scss">
.chat-layout {
  @apply flex min-w-0 flex-1 flex-col overflow-hidden;

  --chat-content-font-size: 0.875rem;
  --chat-content-line-height: 1.6;
  --chat-secondary-font-size: 0.75rem;
  --chat-heading-1-font-size: 1.125rem;
  --chat-heading-2-font-size: 1rem;
  --chat-heading-3-font-size: 0.875rem;
  --chat-heading-4-font-size: 0.8125rem;
  --chat-code-font-size: 0.75rem;

  container-name: agent-panel;
  container-type: inline-size;
}

.chat-layout-toolbar {
  @apply shrink-0 pt-1;

  background: var(--mica-background);
}

.chat-layout-content {
  @apply flex min-h-0 flex-1 overflow-hidden;

  font-size: var(--chat-content-font-size);
  line-height: var(--chat-content-line-height);
}
</style>
