<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppTooltip } from '@/components/AppTooltip';
import { useCloudSyncStore } from '@/features/cloud-sync';
import { useCreationStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useWorkbenchStore } from '@/features/workbench';

const editor = useEditorStore();
const creation = useCreationStore();
const cloud = useCloudSyncStore();
/** 状态栏菜单不分级：两家都登录时把备份目标平铺出来；没登录时只留下面的“云端账户…”。 */
const backupItems = computed(() => {
  if (!cloud.accounts.length) return [];
  const { items, ...single } = cloud.backupMenu;
  const disabled = single.disabled || creation.libraryOpen || !creation.work;
  return (items ?? [single]).map(item => ({
    id: item.id,
    label: !items ? item.label : item.id.endsWith(':all') ? '备份到全部云端账户' : `备份到 ${item.label}`,
    disabled
  }));
});
function restore() {
  // 恢复列表与同作品的选择框显示在作品库。
  void creation.showLibrary().then(() => cloud.openRestore());
}
const notifications = useNotificationStore();
const navigation = useWorkbenchStore();
const status = computed(() => (editor.activeTab?.saving ? '正在保存…' : editor.activeTab?.saveError ? '保存失败' : ''));
</script>

<template>
  <footer class="status-bar" aria-label="状态栏">
    <AppDropdownMenu content-size="sm">
      <template #trigger>
        <AppButton size="xs" variant="ghost">
          <span class="i-mingcute-cloud-line size-4" aria-hidden="true" />
          备份
        </AppButton>
      </template>
      <AppDropdownMenuItem
        v-for="item in backupItems"
        :key="item.id"
        density="sm"
        :disabled="item.disabled"
        @select="cloud.selectBackup(item.id, creation.work)"
        >{{ item.label }}</AppDropdownMenuItem
      >
      <AppDropdownMenuItem density="sm" :disabled="!creation.connected" @select="restore"
        >从云端恢复…</AppDropdownMenuItem
      >
      <AppDropdownMenuItem density="sm" @select="cloud.openAccountSettings()">云端账户…</AppDropdownMenuItem>
    </AppDropdownMenu>
    <span v-if="!creation.connected" class="connection-status" role="status">{{
      creation.busy ? '正在连接作品库…' : '作品库已断开'
    }}</span>
    <div class="status-spacer" />
    <div v-if="editor.activeTab && !creation.libraryOpen" class="document-status">
      <span>{{ editor.activeTab.words }} 字</span
      ><span>{{ editor.activeTab.format === 'markdown' ? 'Markdown' : 'TXT' }}</span
      ><span v-if="status" role="status">{{ status }}</span>
    </div>
    <AppButton v-if="navigation.focusMode" size="xs" variant="ghost" @click="navigation.focusMode = false"
      >退出专注</AppButton
    >
    <AppTooltip :text="notifications.unseenCount ? `${notifications.unseenCount} 条新通知` : '没有通知'" side="top"
      ><AppButton
        size="xs"
        variant="ghost"
        :selected="notifications.isPanelOpen"
        aria-label="打开通知中心"
        @click="notifications.togglePanel()"
        ><span class="i-mingcute-notification-line notification-icon" aria-hidden="true" /><span
          v-if="notifications.unseenCount"
          >{{ notifications.unseenCount }}</span
        ></AppButton
      ></AppTooltip
    >
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  flex-shrink: 0;
  padding: 0 8px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-muted);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.status-spacer {
  flex: 1;
}
.document-status {
  display: flex;
  align-items: center;
  gap: 16px;
  font-variant-numeric: tabular-nums;
}
.notification-icon {
  width: 16px;
  height: 16px;
}
.connection-status {
  white-space: nowrap;
}
</style>
