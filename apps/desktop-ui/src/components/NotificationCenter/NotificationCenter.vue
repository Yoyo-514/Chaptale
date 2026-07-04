<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '../../stores/notification';
import NotificationCenterItem from './NotificationCenterItem.vue';

const notificationStore = useNotificationStore();

const panelTitle = computed(() => (notificationStore.items.length === 0 ? '无新通知' : '通知'));
</script>

<template>
  <Transition name="notification-center-fade">
    <section v-if="notificationStore.isPanelOpen" class="notification-center" aria-label="通知中心">
      <header class="notification-center-header">
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
            :disabled="notificationStore.items.length === 0"
            aria-label="静音通知"
            title="静音通知"
          >
            <span class="i-mingcute-notification-off-line" aria-hidden="true" />
          </button>
          <button class="notification-action-button" type="button" aria-label="切换通知排序" title="切换通知排序">
            <span class="i-mingcute-transfer-3-line" aria-hidden="true" />
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

      <ul v-if="notificationStore.items.length > 0" class="notification-list">
        <NotificationCenterItem
          v-for="notification in notificationStore.recentItems"
          :key="notification.id"
          :notification="notification"
          @dismiss="notificationStore.dismiss"
        />
      </ul>
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

  max-height: min(20rem, calc(100vh - 5rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.35);
  color: var(--popover-foreground);
}

.notification-center-header {
  @apply flex min-h-9 items-center justify-between gap-3 px-2.5 py-1.5;
}

.notification-center-title {
  @apply m-0 min-w-0 flex-1 truncate text-xs font-medium leading-5;

  color: var(--popover-foreground);
}

.notification-center-actions {
  @apply flex shrink-0 items-center gap-0.5;
}

.notification-action-button {
  @apply flex-center shrink-0 border-0 outline-none transition-colors duration-150;

  background: transparent;
  color: var(--muted-foreground);
}

.notification-action-button {
  @apply size-6 rounded text-base;
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
  @apply m-0 flex list-none flex-col overflow-y-auto border-t p-0;

  border-color: var(--border-subtle);
}
</style>
