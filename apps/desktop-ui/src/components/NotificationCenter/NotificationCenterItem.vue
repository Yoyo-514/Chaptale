<script setup lang="ts">
import type { NotificationItem } from '../../stores/notification';
import { formatNotificationTime, getNotificationIcon } from './notification-display';

const props = defineProps<{
  notification: NotificationItem;
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();
</script>

<template>
  <li class="notification-item" :class="`is-${props.notification.kind}`">
    <span :class="['notification-item-icon', getNotificationIcon(props.notification.kind)]" aria-hidden="true" />
    <div class="notification-item-copy">
      <div class="notification-item-heading">
        <strong>{{ props.notification.title }}</strong>
        <time>{{ formatNotificationTime(props.notification.createdAt) }}</time>
      </div>
      <p v-if="props.notification.description" class="notification-item-description">
        {{ props.notification.description }}
      </p>
    </div>
    <button
      class="notification-dismiss-button"
      type="button"
      aria-label="移除通知"
      title="移除通知"
      @click="emit('dismiss', props.notification.id)"
    >
      <span class="i-mingcute-close-line" aria-hidden="true" />
    </button>
  </li>
</template>

<style scoped lang="scss">
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
  @apply flex-center size-6 shrink-0 rounded border-0 text-sm outline-none transition-colors duration-150;

  background: transparent;
  color: var(--muted-foreground);
}

.notification-dismiss-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}
</style>
