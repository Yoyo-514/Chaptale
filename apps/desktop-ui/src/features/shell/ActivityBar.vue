<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

const settings = useSettingsStore();
const navigation = useWorkbenchStore();
function toggleAgent() {
  if (navigation.agentInMain) navigation.showAgent();
  else navigation.toggleAuxiliary();
}
</script>

<template>
  <aside class="activity-bar" aria-label="应用活动栏">
    <nav class="activity-bar-primary" aria-label="创作视图">
      <AppTooltip text="作品" side="right" :side-offset="8">
        <AppButton
          class="activity-button"
          icon
          variant="ghost"
          type="button"
          aria-label="作品"
          :aria-pressed="navigation.sidebarOpen && !navigation.focusMode"
          :selected="navigation.sidebarOpen && !navigation.focusMode"
          @click="navigation.toggleSidebar()"
        >
          <span class="i-mingcute-folder-2-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="会话" side="right" :side-offset="8">
        <AppButton
          class="activity-button"
          icon
          variant="ghost"
          type="button"
          aria-label="会话"
          :aria-pressed="(navigation.auxiliaryOpen || navigation.agentInMain) && !navigation.focusMode"
          :selected="(navigation.auxiliaryOpen || navigation.agentInMain) && !navigation.focusMode"
          @click="toggleAgent"
        >
          <span class="i-mingcute-chat-3-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </nav>
    <div class="activity-bar-secondary">
      <AppTooltip text="设置" side="right" :side-offset="8">
        <AppButton
          class="activity-button"
          icon
          variant="ghost"
          type="button"
          aria-label="打开设置"
          :aria-pressed="settings.isOpen"
          :selected="settings.isOpen"
          @click="settings.openPanel()"
        >
          <span class="i-mingcute-settings-3-line activity-icon" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.activity-bar {
  @apply flex h-full w-12 shrink-0 flex-col items-center justify-between border-r py-2;
  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
}
.activity-bar-primary,
.activity-bar-secondary {
  @apply flex flex-col items-center gap-1;
}
.activity-bar .activity-button {
  @apply relative h-10 w-10;
  color: var(--muted-foreground);
  border-radius: var(--radius-control);
}
.activity-bar .activity-button:hover {
  color: var(--foreground);
  background: var(--surface-hover);
}
.activity-bar .activity-button[aria-pressed='true'] {
  color: var(--primary-solid);
}
.activity-bar .activity-button[aria-pressed='true']::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
  background: var(--primary-solid);
}
.activity-bar .activity-button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.activity-icon {
  width: 22px;
  height: 22px;
  font-size: 22px;
}
</style>
