<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

const settingsStore = useSettingsStore();
const navigation = useWorkbenchStore();

const activities = [
  { id: 'workspace', label: '作品', icon: 'i-mingcute-folder-2-line', available: true },
  { id: 'search', label: '搜索', icon: 'i-mingcute-search-line', available: true },
  { id: 'structure', label: '资料库', icon: 'i-mingcute-grid-line', available: true },
  { id: 'review', label: '审查', icon: 'i-mingcute-check-circle-line', available: true },
  { id: 'memory', label: '记忆', icon: 'i-mingcute-brain-line', available: true }
] as const;
</script>

<template>
  <aside class="activity-bar" aria-label="应用活动栏">
    <nav class="activity-bar-primary" aria-label="创作视图">
      <AppTooltip v-if="navigation.isCompact" text="返回编辑器" side="right">
        <AppButton
          icon
          size="lg"
          variant="ghost"
          aria-label="返回编辑器"
          :selected="navigation.compactPane === 'editor'"
          @click="navigation.focusEditor()"
        >
          <span class="i-mingcute-edit-2-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip
        v-for="activity in activities"
        :key="activity.id"
        :text="activity.label"
        side="right"
        :side-offset="6"
      >
        <AppButton
          icon
          size="lg"
          variant="ghost"
          type="button"
          :selected="activity.id === navigation.sidebar && navigation.sidebarOpen && !navigation.focusMode"
          :disabled="!activity.available"
          :aria-current="
            activity.id === navigation.sidebar && navigation.sidebarOpen && !navigation.focusMode ? 'page' : undefined
          "
          :aria-label="activity.label"
          @click="navigation.toggleSidebar(activity.id)"
        >
          <span :class="[activity.icon, 'activity-icon']" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </nav>

    <div class="activity-bar-spacer" />

    <div class="activity-bar-secondary">
      <AppTooltip
        :text="navigation.auxiliaryOpen && !navigation.focusMode ? '隐藏辅助栏' : '打开辅助栏'"
        side="right"
        :side-offset="6"
      >
        <AppButton
          icon
          size="lg"
          variant="ghost"
          type="button"
          aria-label="切换 Agent 面板"
          :aria-pressed="navigation.auxiliaryOpen && !navigation.focusMode"
          :selected="navigation.auxiliaryOpen && !navigation.focusMode"
          @click="navigation.toggleAuxiliary"
        >
          <span class="i-mingcute-chat-3-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="设置" side="right" :side-offset="6" with-arrow>
        <AppButton
          icon
          size="lg"
          variant="ghost"
          type="button"
          aria-label="打开设置"
          @click="settingsStore.openPanel()"
        >
          <span class="i-mingcute-settings-3-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.activity-bar {
  @apply flex h-full w-12 shrink-0 flex-col items-center border-r px-1.5 py-2;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.activity-bar-primary,
.activity-bar-secondary {
  @apply flex flex-col items-center gap-1;
}

.activity-bar-spacer {
  @apply flex-1;
}
.activity-icon {
  width: 24px;
  height: 24px;
  font-size: 24px;
}
</style>
