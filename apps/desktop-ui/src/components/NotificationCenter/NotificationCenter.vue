<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore, type NotificationItem } from '../../stores/notification';

const notificationStore = useNotificationStore();

const panelTitle = computed(() => (notificationStore.items.length === 0 ? '无新通知' : '通知'));

function getNotificationIcon(kind: NotificationItem['kind']) {
  if (kind === 'error') return 'i-mingcute-warning-line';
  if (kind === 'success') return 'i-mingcute-check-circle-line';
  return 'i-mingcute-information-line';
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}
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
        <li
          v-for="notification in notificationStore.recentItems"
          :key="notification.id"
          class="notification-item"
          :class="`is-${notification.kind}`"
        >
          <span :class="['notification-item-icon', getNotificationIcon(notification.kind)]" aria-hidden="true" />
          <div class="notification-item-copy">
            <div class="notification-item-heading">
              <strong>{{ notification.title }}</strong>
              <time>{{ formatTime(notification.createdAt) }}</time>
            </div>
            <p v-if="notification.description" class="notification-item-description">
              {{ notification.description }}
            </p>
          </div>
          <button
            class="notification-dismiss-button"
            type="button"
            aria-label="移除通知"
            title="移除通知"
            @click="notificationStore.dismiss(notification.id)"
          >
            <span class="i-mingcute-close-line" aria-hidden="true" />
          </button>
        </li>
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

.notification-action-button,
.notification-dismiss-button {
  @apply flex-center shrink-0 border-0 outline-none transition-colors duration-150;

  background: transparent;
  color: var(--muted-foreground);
}

.notification-action-button {
  @apply size-6 rounded text-base;
}

.notification-action-button:hover,
.notification-dismiss-button:hover {
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

.notification-item {
  @apply flex gap-2 border-b px-3 py-2.5;

  border-color: var(--border-subtle);
}

.notification-item:last-child {
  border-bottom: 0;
}

.notification-item-icon {
  @apply mt-0.5 size-4 shrink-0;

  color: var(--muted-foreground);
}

.notification-item.is-error .notification-item-icon {
  color: var(--destructive);
}

.notification-item.is-success .notification-item-icon {
  color: var(--primary-solid);
}

.notification-item-copy {
  @apply min-w-0 flex-1;
}

.notification-item-heading {
  @apply flex items-start justify-between gap-3;
}

.notification-item-heading strong {
  @apply min-w-0 break-words text-xs font-semibold leading-4;
}

.notification-item-heading time {
  @apply shrink-0 text-[10px] leading-4;

  color: var(--muted-foreground);
}

.notification-item-description {
  @apply m-0 mt-1 break-words text-xs leading-4;

  color: var(--muted-foreground);
}

.notification-dismiss-button {
  @apply size-6 rounded text-sm;
}
</style>
