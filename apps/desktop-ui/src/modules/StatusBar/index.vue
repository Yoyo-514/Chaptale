<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import AppButton from '@/components/AppButton/AppButton.vue';
import AppTooltip from '@/components/AppTooltip/AppTooltip.vue';

const notificationStore = useNotificationStore();

const hasError = computed(() => notificationStore.items.some(item => item.kind === 'error'));
const notificationCountLabel = computed(() =>
  notificationStore.unseenCount > 99 ? '99+' : String(notificationStore.unseenCount)
);
const notificationTooltip = computed(() =>
  notificationStore.unseenCount > 0 ? `${notificationStore.unseenCount} 条新通知` : '没有通知'
);
</script>

<template>
  <footer class="status-bar" aria-label="状态栏">
    <div class="status-bar-spacer" />

    <AppTooltip :text="notificationTooltip" side="top" :side-offset="6">
      <AppButton
        variant="ghost"
        size="xs"
        class="status-notification-button"
        :class="{ 'has-error': hasError }"
        type="button"
        :selected="notificationStore.isPanelOpen"
        :aria-expanded="notificationStore.isPanelOpen"
        aria-label="打开通知中心"
        @click="notificationStore.togglePanel()"
      >
        <span class="i-mingcute-notification-line size-4.5" aria-hidden="true" />
        <span v-if="notificationStore.unseenCount > 0" class="notification-count">{{ notificationCountLabel }}</span>
      </AppButton>
    </AppTooltip>
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
  @apply h-full min-w-8 gap-1 px-1.5 rounded-0;
}

.status-notification-button[aria-expanded='true'] {
  background: none;
}

.status-notification-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.status-notification-button.has-error {
  color: var(--destructive);
}

.notification-count {
  @apply min-w-4 rounded-full px-1 text-[10px] leading-3.5;

  background: var(--primary-solid);
  color: var(--primary-solid-foreground);
}
</style>
