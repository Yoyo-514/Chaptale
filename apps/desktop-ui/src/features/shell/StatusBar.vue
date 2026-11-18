<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useCreationStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useWorkbenchStore } from '@/features/workbench';

const editor = useEditorStore();
const creation = useCreationStore();
const notifications = useNotificationStore();
const navigation = useWorkbenchStore();
const status = computed(() => (editor.activeTab?.saving ? '正在保存…' : editor.activeTab?.saveError ? '保存失败' : ''));
</script>

<template>
  <footer class="status-bar" aria-label="状态栏">
    <span class="connection-status">{{
      creation.connected ? '本机存储' : creation.busy ? '正在连接…' : '存储已断开'
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
