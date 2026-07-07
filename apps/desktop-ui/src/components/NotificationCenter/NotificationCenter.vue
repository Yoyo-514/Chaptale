<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '../../stores/notification';
import NotificationCenterItem from './NotificationCenterItem.vue';

const notificationStore = useNotificationStore();

const isManualPanel = computed(() => notificationStore.panelMode === 'manual');
const panelTitle = computed(() => (notificationStore.items.length === 0 ? '无新通知' : '通知'));
const visibleNotifications = computed(() =>
  isManualPanel.value ? notificationStore.allItems : notificationStore.recentItems
);
</script>

<template>
  <Transition name="notification-center-fade">
    <section
      v-if="notificationStore.isPanelOpen"
      class="notification-center"
      :class="{ 'is-manual': isManualPanel, 'is-auto': !isManualPanel }"
      aria-label="通知中心"
    >
      <header v-if="isManualPanel" class="notification-center-header">
        <h2 class="notification-center-title">{{ panelTitle }}</h2>
        <div class="notification-center-actions">
          <button
            class="notification-action-button"
            type="button"
            :disabled="notificationStore.items.length === 0"
            aria-label="清空通知"
            title="清空通知"
            @click="notificationStore.clear()"
          >
            <span class="i-mingcute-delete-2-line" aria-hidden="true" />
          </button>
          <button
            class="notification-action-button"
            type="button"
            aria-label="隐藏通知中心"
            title="隐藏通知中心"
            @click="notificationStore.closePanel()"
          >
            <span class="i-mingcute-down-line" aria-hidden="true" />
          </button>
        </div>
      </header>

      <ul v-if="visibleNotifications.length > 0" class="notification-list">
        <NotificationCenterItem
          v-for="notification in visibleNotifications"
          :key="notification.id"
          :notification="notification"
          @dismiss="notificationStore.dismiss"
        />
      </ul>
      <div v-else-if="isManualPanel" class="notification-empty">暂无通知</div>
    </section>
  </Transition>
</template>

<style scoped lang="scss">
.notification-center-fade-enter-active,
.notification-center-fade-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.notification-center-fade-enter-from,
.notification-center-fade-leave-to {
  opacity: 0;
  transform: translateY(0.5rem) scale(0.98);
}

.notification-center {
  @apply fixed bottom-7 right-3 z-[80] flex w-[28rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden border shadow-float;

  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.35);
  color: var(--popover-foreground);
}

.notification-center.is-auto {
  max-height: min(18rem, calc(100vh - 5rem));
}

.notification-center.is-manual {
  max-height: min(28rem, calc((100vh - 5rem) / 2));
}

.notification-center-header {
  @apply flex min-h-9 items-center justify-between gap-3 border-b px-2.5 py-1.5;

  border-color: var(--border-subtle);
}

.notification-center-title {
  @apply m-0 min-w-0 flex-1 truncate text-xs font-medium leading-5;

  color: var(--popover-foreground);
}

.notification-center-actions {
  @apply flex shrink-0 items-center gap-0.5;
}

.notification-action-button {
  @apply flex-center size-6 shrink-0 rounded border-0 text-base outline-none transition-colors duration-150;

  background: transparent;
  color: var(--muted-foreground);
}

.notification-action-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.notification-action-button:disabled {
  @apply cursor-default;

  background: transparent;
  color: var(--muted-foreground);
  opacity: 0.45;
}

.notification-list {
  @apply m-0 flex min-h-0 list-none flex-col overflow-y-auto p-0;
}

.notification-empty {
  @apply px-3 py-4 text-center text-xs;

  color: var(--muted-foreground);
}
</style>
