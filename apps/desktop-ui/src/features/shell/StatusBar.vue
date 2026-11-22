<script setup lang="ts">
import { computed } from 'vue';

import { CLOUD_PROVIDER_LABELS, isCloudProvider } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from '@/components/AppDropdownMenu';
import { AppTooltip } from '@/components/AppTooltip';
import { formatWhen, useCloudSyncStore, useScheduledBackupStore } from '@/features/cloud-sync';
import { useCreationStore, useWorkPackageStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

import { useAppUpdateStore } from './help/updates';

const editor = useEditorStore();
const updates = useAppUpdateStore();
const creation = useCreationStore();
const cloud = useCloudSyncStore();
const backup = useScheduledBackupStore();
const packages = useWorkPackageStore();
const settings = useSettingsStore();
/** 状态栏菜单不分级：两家都登录时把上传目标平铺出来；没登录时不显示。 */
const uploadItems = computed(() => {
  if (!cloud.accounts.length) return [];
  const { items, ...single } = cloud.backupMenu;
  const work = creation.libraryOpen ? undefined : creation.work;
  const subject = work ? `《${work.title}》` : '当前作品';
  const disabled = single.disabled || !work;
  if (cloud.backingUp !== null) return [{ id: single.id, label: single.label, disabled }];
  return (items ?? [single]).map(item => {
    const target = item.id.slice(item.id.indexOf(':') + 1);
    const provider = isCloudProvider(target) ? ` ${CLOUD_PROVIDER_LABELS[target]}` : '全部云端账户';
    return { id: item.id, label: `上传${subject}到${provider}`, disabled };
  });
});
/** 失败时列出原因；否则给出最近一次本机备份的时间。 */
const backupHint = computed(() => {
  const state = backup.state;
  if (!state) return '备份';
  if (state.failures.length) return state.failures.map(({ title, message }) => `${title}：${message}`).join('；');
  const last = state.lastBackupAt ? `上次备份 ${formatWhen(state.lastBackupAt)}` : '还没有备份';
  return state.settings.enabled ? last : `${last}（定时备份已关闭）`;
});
// 恢复列表与同作品的选择框显示在作品库。
function restoreFromCloud() {
  void creation.showLibrary().then(() => cloud.openRestore());
}
async function restoreFromLocal() {
  const path = await backup.pickBackup();
  if (path) await creation.showLibrary().then(() => packages.chooseImport({ path, downloaded: false }));
}
const notifications = useNotificationStore();
const navigation = useWorkbenchStore();
const status = computed(() => (editor.activeTab?.saving ? '正在保存…' : editor.activeTab?.saveError ? '保存失败' : ''));
</script>

<template>
  <footer class="status-bar" aria-label="状态栏">
    <AppDropdownMenu content-size="sm">
      <template #trigger>
        <AppTooltip :text="backupHint" side="top">
          <AppButton size="xs" variant="ghost" :class="{ 'has-failure': backup.state?.failures.length }">
            <span class="i-mingcute-cloud-line backup-icon" aria-hidden="true" />
            备份
          </AppButton>
        </AppTooltip>
      </template>
      <AppDropdownMenuItem density="sm" :disabled="!creation.connected || backup.backingUp" @select="backup.backupNow()"
        >立即备份</AppDropdownMenuItem
      >
      <AppDropdownMenuItem density="sm" :disabled="!backup.state?.settings.directory" @select="backup.openDirectory()"
        >打开备份文件夹</AppDropdownMenuItem
      >
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem
        v-for="item in uploadItems"
        :key="item.id"
        density="sm"
        :disabled="item.disabled"
        @select="cloud.selectBackup(item.id, creation.work)"
        >{{ item.label }}</AppDropdownMenuItem
      >
      <AppDropdownMenuItem density="sm" :disabled="!creation.connected" @select="restoreFromCloud"
        >从云端恢复…</AppDropdownMenuItem
      >
      <AppDropdownMenuItem density="sm" :disabled="!creation.connected" @select="restoreFromLocal"
        >从本机备份恢复…</AppDropdownMenuItem
      >
      <AppDropdownMenuSeparator />
      <AppDropdownMenuItem density="sm" @select="settings.openPanel('backup')">备份设置…</AppDropdownMenuItem>
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
    <AppTooltip v-if="updates.available" :text="`查看 ${updates.available.version} 的更新说明`" side="top">
      <AppButton
        size="xs"
        variant="ghost"
        class="update-status"
        aria-label="有新版本，查看更新说明"
        @click="updates.showDetails(updates.available!)"
      >
        <span class="i-mingcute-arrow-up-circle-line size-4" aria-hidden="true" />
        有新版本
      </AppButton>
    </AppTooltip>
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
.backup-icon {
  width: 16px;
  height: 16px;
}
.has-failure .backup-icon {
  color: var(--warning);
}
.update-status {
  white-space: nowrap;
}
.update-status span {
  color: var(--primary);
}
.notification-icon {
  width: 16px;
  height: 16px;
}
.connection-status {
  white-space: nowrap;
}
</style>
