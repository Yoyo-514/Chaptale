<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '../../stores/notification';

const notificationStore = useNotificationStore();

const hasError = computed(() => notificationStore.items.some(item => item.kind === 'error'));
const notificationCountLabel = computed(() =>
  notificationStore.unreadCount > 99 ? '99+' : String(notificationStore.unreadCount)
);
</script>

<template>
  <footer class="status-bar" aria-label="状态栏">
    <div class="status-bar-spacer" />

    <button
      class="status-notification-button"
      :class="{ 'has-error': hasError }"
      type="button"
      :aria-expanded="notificationStore.isPanelOpen"
      aria-label="打开通知中心"
      @click="notificationStore.togglePanel()"
    >
      <span class="i-mingcute-notification-line status-notification-icon" aria-hidden="true" />
      <span v-if="notificationStore.unreadCount > 0" class="notification-count">{{ notificationCountLabel }}</span>
    </button>
  </footer>
</template>

<style scoped lang="scss">
.status-bar {
  @apply relative z-40 flex h-5 shrink-0 items-center border-t px-1 text-xs;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.status-bar-spacer {
  @apply flex-1;
}

.status-notification-button {
  @apply flex h-full min-w-8 items-center justify-center gap-1 border-0 px-1.5 outline-none transition-colors duration-150;

  background: transparent;
  color: var(--muted-foreground);
}

.status-notification-button:hover,
.status-notification-button[aria-expanded='true'] {
  background: var(--surface-muted);
  color: var(--foreground);
}

.status-notification-button.has-error {
  color: var(--destructive);
}

.status-notification-icon {
  @apply size-4.5;
}

.notification-count {
  @apply min-w-4 rounded-full px-1 text-[10px] leading-3.5;

  background: var(--primary-solid);
  color: var(--primary-solid-foreground);
}
</style>
