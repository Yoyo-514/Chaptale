<script setup lang="ts">
import { AppScrollArea } from '@/components/AppScrollArea';
import type { NotificationItem as Notification } from '@/stores/notification';
import NotificationCenterItem from './NotificationCenterItem.vue';

const props = defineProps<{
  notifications: Notification[];
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();
</script>

<template>
  <AppScrollArea class="notification-list">
    <NotificationCenterItem
      v-for="notification in props.notifications"
      :key="notification.id"
      :notification="notification"
      @dismiss="emit('dismiss', $event)"
    />
  </AppScrollArea>
</template>

<style scoped lang="scss">
.notification-list {
  @apply m-0 flex flex-col p-0;
}
</style>
