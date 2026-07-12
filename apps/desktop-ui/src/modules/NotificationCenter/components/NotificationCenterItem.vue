<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import type { NotificationItem, NotificationPanelMode } from '@/stores/notification';
import { formatNotificationTime, getNotificationIcon } from '../utils/notification-display';

const props = defineProps<{
  notification: NotificationItem;
  mode: NotificationPanelMode;
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();
</script>

<template>
  <div class="notification-item" :class="[`is-${props.notification.kind}`, `is-${props.mode}`]">
    <div class="notification-item-main-row">
      <span :class="['notification-item-icon', getNotificationIcon(props.notification.kind)]" aria-hidden="true" />
      <strong class="notification-item-title" :title="props.notification.title">
        {{ props.notification.title }}
      </strong>
      <div class="notification-item-toolbar">
        <AppButton
          icon
          variant="ghost"
          size="xs"
          type="button"
          aria-label="移除通知"
          title="移除通知"
          @click="emit('dismiss', props.notification.id)"
        >
          <span class="i-mingcute-close-line size-4" aria-hidden="true" />
        </AppButton>
      </div>
    </div>

    <p v-if="props.notification.description" class="notification-item-description">
      {{ props.notification.description }}
    </p>

    <div class="notification-item-details-row">
      <time :datetime="new Date(props.notification.createdAt).toISOString()">
        {{ formatNotificationTime(props.notification.createdAt) }}
      </time>
    </div>
  </div>
</template>

<style scoped lang="scss">
.notification-item {
  @apply flex flex-col border-b px-2 py-2.5;

  border-color: var(--border-subtle);
}

.notification-item:last-child {
  border-bottom: 0;
}

.notification-item-main-row {
  @apply flex min-w-0 items-start gap-2;
}

.notification-item-icon {
  @apply flex h-5 w-4 shrink-0 items-center justify-center text-base;

  color: var(--muted-foreground);
}

.notification-item.is-error .notification-item-icon {
  color: var(--destructive);
}

.notification-item.is-success .notification-item-icon {
  color: var(--primary-solid);
}

.notification-item-title {
  @apply min-w-0 flex-1 truncate text-xs font-semibold leading-5;
}

.notification-item-toolbar {
  @apply flex h-5 w-6 shrink-0 items-center justify-center opacity-0 transition-opacity duration-150 pointer-events-none;
}

.notification-item.is-manual .notification-item-toolbar,
.notification-item:hover .notification-item-toolbar,
.notification-item:focus-within .notification-item-toolbar,
.notification-item.is-expanded .notification-item-toolbar {
  @apply opacity-100 pointer-events-auto;
}

.notification-item-description,
.notification-item-details-row {
  margin-left: 1.5rem;
}

.notification-item-description {
  @apply mt-1 mb-0 break-words text-xs leading-4;

  color: var(--popover-foreground);
}

.notification-item-details-row {
  @apply mt-1 flex min-w-0 items-center;
}

.notification-item-details-row time {
  @apply shrink-0 text-[10px] leading-4;

  color: var(--muted-foreground);
}
</style>
