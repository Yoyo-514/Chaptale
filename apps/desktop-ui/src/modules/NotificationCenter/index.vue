<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import NotificationCenterHeader from './components/NotificationCenterHeader.vue';
import NotificationCenterList from './components/NotificationCenterList.vue';

const notificationStore = useNotificationStore();

const isManualPanel = computed(() => notificationStore.panelMode === 'manual');
const panelTitle = computed(() => (notificationStore.items.length === 0 ? '无新通知' : '通知'));
const visibleNotifications = computed(() =>
  isManualPanel.value ? notificationStore.allItems : notificationStore.recentUnseenItems
);
// 自动弹出模式下若没有未看过的新通知（如刚被逐条移除），不展示空面板。
const isPanelVisible = computed(
  () => notificationStore.isPanelOpen && (isManualPanel.value || visibleNotifications.value.length > 0)
);
</script>

<template>
  <Transition name="notification-center-fade">
    <section
      v-if="isPanelVisible"
      class="notification-center"
      :class="{ 'is-manual': isManualPanel, 'is-auto': !isManualPanel }"
      aria-label="通知中心"
    >
      <NotificationCenterHeader
        v-if="isManualPanel"
        :title="panelTitle"
        :can-clear="notificationStore.items.length > 0"
        @clear="notificationStore.clear()"
        @close="notificationStore.closePanel()"
      />

      <NotificationCenterList
        v-if="visibleNotifications.length > 0"
        :notifications="visibleNotifications"
        @dismiss="notificationStore.dismiss"
      />
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

.notification-empty {
  @apply px-3 py-4 text-center text-xs;

  color: var(--muted-foreground);
}
</style>
