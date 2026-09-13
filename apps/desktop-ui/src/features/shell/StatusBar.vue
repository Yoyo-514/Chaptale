<script setup lang="ts">
import { computed, watch } from 'vue';

import { CLOUD_PROVIDER_LABELS } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useCloudSyncStore, formatWhen } from '@/features/cloud-sync';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useWorkbenchStore } from '@/features/workbench';
import { localSyncSummary, useWorkspaceStore } from '@/features/workspace';
import { hasDesktopApi } from '@/utils/desktop-api';

const cloud = useCloudSyncStore();
const notificationStore = useNotificationStore();
const editor = useEditorStore();
const workspace = useWorkspaceStore();
const navigation = useWorkbenchStore();
const syncStatus = computed(() => localSyncSummary(workspace.rootPath, editor.tabs));
const syncDetail = computed(
  () => `${workspace.rootPath ?? '未打开作品'}；${syncStatus.value.label}；${cloudDetail.value}`
);

/** 云端状态只用本地就能回答：没登录、没绑定、已绑定；要不要再备一次看本机上次备份时间。 */
const cloudLabel = computed(() => {
  if (cloud.accounts.length === 0) return '云端未登录';

  return cloud.binding ? '云端已绑定' : '未绑定云端';
});

const lastBackupLabel = computed(() =>
  cloud.lastBackupAt ? `本机上次备份 ${formatWhen(cloud.lastBackupAt)}` : '本机还没备份过'
);

const cloudDetail = computed(
  () =>
    cloud.bindingError ||
    (cloud.binding
      ? `${CLOUD_PROVIDER_LABELS[cloud.binding.provider]} · ${cloud.binding.folderName}；${lastBackupLabel.value}`
      : '点这里打开文件与同步面板')
);

function refreshCloud() {
  if (!hasDesktopApi()) return;

  void cloud.load();
  void cloud.loadBinding();
}

// 换作品就要重新问一次绑定；绑定是按作品存的。
watch(() => workspace.rootPath, refreshCloud, { immediate: true });

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
    <AppTooltip :text="syncDetail" side="top">
      <AppButton
        variant="ghost"
        size="xs"
        class="status-sync"
        :class="{ 'has-error': syncStatus.error }"
        aria-label="文件与同步"
        :aria-expanded="workspace.syncOpen"
        @click="workspace.syncOpen = !workspace.syncOpen"
      >
        <span
          :class="syncStatus.error ? 'i-mingcute-warning-line' : 'i-mingcute-file-line'"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">{{ syncStatus.label }}</span>
        <span class="status-divider" aria-hidden="true">·</span>
        <span class="status-cloud" :class="{ 'is-muted': !cloud.binding }" aria-hidden="true">
          <span class="i-mingcute-cloud-line size-3.5 shrink-0" />
          <span class="truncate">{{ cloudLabel }}</span>
        </span>
      </AppButton>
    </AppTooltip>
    <div class="status-bar-spacer" />
    <AppButton v-if="navigation.focusMode" size="xs" variant="ghost" @click="navigation.focusMode = false"
      >退出专注</AppButton
    >

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
        <span class="i-mingcute-notification-line size-4" aria-hidden="true" />
        <span v-if="notificationStore.unseenCount > 0" class="notification-count">{{ notificationCountLabel }}</span>
      </AppButton>
    </AppTooltip>
  </footer>
</template>

<style scoped lang="scss">
.status-bar {
  @apply relative z-$z-app-chrome flex h-8 shrink-0 items-center border-t px-1 text-xs;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.status-bar-spacer {
  @apply flex-1;
}
.status-sync {
  @apply flex min-w-0 items-center gap-1.5 px-2;
  font-size: var(--ui-caption-size);
}
.status-divider {
  @apply shrink-0;
}
.status-cloud {
  @apply flex min-w-0 shrink-0 items-center gap-1;

  color: var(--primary-solid);
}
.status-cloud.is-muted {
  color: var(--muted-foreground);
}
.has-error {
  color: var(--destructive);
}

.status-notification-button {
  @apply h-full min-w-8 gap-1 px-1.5 rounded-0;
}

.status-notification-button[aria-expanded='true'] {
  background: none;
}

.status-notification-button:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}

.status-notification-button.has-error {
  color: var(--destructive);
}

.notification-count {
  @apply min-w-4 rounded-full px-1 text-xs leading-4;

  background: var(--primary-solid);
  color: var(--primary-solid-foreground);
}
</style>
