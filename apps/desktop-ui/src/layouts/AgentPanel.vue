<script setup lang="ts">
import { RouterView } from 'vue-router';

import { ChatToolbar } from '@/features/chat';
</script>

<template>
  <main class="chat-layout">
    <header class="chat-layout-toolbar">
      <ChatToolbar />
    </header>

    <div class="chat-layout-content">
      <RouterView />
    </div>
  </main>
</template>

<style scoped lang="scss">
.chat-layout {
  @apply flex min-w-0 flex-1 flex-col overflow-hidden;
}

.chat-layout-toolbar {
  @apply shrink-0 px-4 pt-3;

  background: var(--mica-background);
}

.chat-layout-content {
  @apply flex min-h-0 flex-1 overflow-hidden;
}
</style>
