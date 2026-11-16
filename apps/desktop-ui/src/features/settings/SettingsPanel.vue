<script setup lang="ts">
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { defineAsyncComponent, onMounted, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useDraggablePanel, type ResizeDirection } from '@/composables';
import { CloudSyncSettings } from '@/features/cloud-sync';

import SettingsSidebar from './components/SettingsSidebar.vue';
import DataDirectorySettings from './sections/DataDirectorySettings.vue';
import InstructionSettings from './sections/InstructionSettings.vue';
import ModelSettings from './sections/ModelSettings.vue';
import SkillSettings from './sections/SkillSettings.vue';
import ToolPermissionSettings from './sections/ToolPermissionSettings.vue';
import { useSettingsStore } from './store';

const WritingSettings = defineAsyncComponent(() => import('./sections/WritingSettings.vue'));

const resizeDirections: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const settingsStore = useSettingsStore();
const {
  panelStyle,
  centerPanel,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handleResizePointerDown,
  handleResizePointerMove,
  handleResizePointerUp
} = useDraggablePanel({
  initialX: 88,
  initialY: 72,
  initialWidth: 1040,
  initialHeight: 720,
  minX: 16,
  minY: 16,
  minWidth: 680,
  minHeight: 420,
  viewportPadding: 16
});

// 首次打开时居中；之后保留作者拖动和缩放后的位置。
let placed = false;
watch(
  () => settingsStore.isOpen,
  open => {
    if (!open || placed) return;
    placed = true;
    centerPanel();
  },
  { immediate: true }
);

onMounted(() => {
  if (settingsStore.isOpen && !settingsStore.state) {
    void settingsStore.load();
  }
});
</script>

<template>
  <DialogRoot :open="settingsStore.isOpen" :modal="false" @update:open="!$event && settingsStore.closePanel()">
    <DialogPortal>
      <div v-if="settingsStore.isOpen" class="settings-panel-layer">
        <DialogContent as-child :aria-describedby="undefined" @interact-outside="$event.preventDefault()">
          <section class="settings-panel" :style="panelStyle" aria-labelledby="settings-panel-title">
            <header
              class="settings-panel-header"
              @pointerdown="handlePointerDown"
              @pointermove="handlePointerMove"
              @pointerup="handlePointerUp"
              @pointercancel="handlePointerUp"
            >
              <div>
                <DialogTitle as-child><h2 id="settings-panel-title" class="settings-panel-title">设置</h2></DialogTitle>
              </div>
              <div class="settings-panel-window-actions">
                <AppButton
                  icon
                  variant="ghost"
                  size="sm"
                  aria-label="居中设置面板"
                  title="居中设置面板"
                  @click="centerPanel"
                >
                  <span class="i-mingcute-align-center-line size-4" aria-hidden="true" />
                </AppButton>
                <AppButton
                  icon
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label="关闭设置"
                  title="关闭设置"
                  @click="settingsStore.closePanel()"
                >
                  <span class="i-mingcute-close-line size-4" aria-hidden="true" />
                </AppButton>
              </div>
            </header>

            <div class="settings-panel-shell">
              <SettingsSidebar />

              <main class="settings-panel-content">
                <WritingSettings v-if="settingsStore.activeSection === 'writing'" />
                <ModelSettings v-else-if="settingsStore.activeSection === 'llm'" />
                <InstructionSettings v-else-if="settingsStore.activeSection === 'prompt'" />
                <SkillSettings v-else-if="settingsStore.activeSection === 'skills'" />
                <ToolPermissionSettings v-else-if="settingsStore.activeSection === 'permissions'" />
                <CloudSyncSettings v-else-if="settingsStore.activeSection === 'cloudSync'" />
                <DataDirectorySettings v-else />
              </main>
            </div>

            <span
              v-for="direction in resizeDirections"
              :key="direction"
              class="settings-panel-resize-handle"
              :class="`is-${direction}`"
              data-panel-resize-handle
              aria-hidden="true"
              @pointerdown="handleResizePointerDown(direction, $event)"
              @pointermove="handleResizePointerMove"
              @pointerup="handleResizePointerUp"
              @pointercancel="handleResizePointerUp"
            />
          </section>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped lang="scss">
.settings-panel-layer {
  @apply fixed inset-0 z-$z-floating-panel pointer-events-none;
}

.settings-panel {
  @apply pointer-events-auto fixed left-0 top-0 flex flex-col overflow-hidden border shadow-$shadow-float;

  background: var(--surface-elevated);
  border-color: var(--border);
  border-radius: var(--radius-overlay);
  color: var(--popover-foreground);
  container-type: inline-size;
  container-name: settings-panel;
}

.settings-panel-header {
  @apply flex min-h-12 shrink-0 cursor-move items-center justify-between gap-4 border-b px-4 py-2 select-none;

  border-color: var(--border-subtle);
}

.settings-panel-title {
  @apply m-0 text-base font-semibold;
}
.settings-panel-window-actions {
  @apply flex shrink-0 items-center gap-1;
}

.settings-panel-shell {
  @apply grid min-h-0 flex-1 grid-cols-[10.5rem_minmax(0,1fr)];
}

.settings-panel-content {
  @apply min-h-0 min-w-0 overflow-hidden;
}

.settings-panel-resize-handle {
  @apply absolute z-$z-local-overlay block;
}

.settings-panel-resize-handle.is-n,
.settings-panel-resize-handle.is-s {
  @apply left-3 right-3 h-2;

  cursor: ns-resize;
}

.settings-panel-resize-handle.is-n {
  @apply top-0;
}

.settings-panel-resize-handle.is-s {
  @apply bottom-0;
}

.settings-panel-resize-handle.is-e,
.settings-panel-resize-handle.is-w {
  @apply bottom-3 top-3 w-2;

  cursor: ew-resize;
}

.settings-panel-resize-handle.is-e {
  @apply right-0;
}

.settings-panel-resize-handle.is-w {
  @apply left-0;
}

.settings-panel-resize-handle.is-ne,
.settings-panel-resize-handle.is-nw,
.settings-panel-resize-handle.is-se,
.settings-panel-resize-handle.is-sw {
  @apply size-4;
}

.settings-panel-resize-handle.is-ne {
  @apply right-0 top-0;

  cursor: nesw-resize;
}

.settings-panel-resize-handle.is-nw {
  @apply left-0 top-0;

  cursor: nwse-resize;
}

.settings-panel-resize-handle.is-se {
  @apply bottom-0 right-0;

  cursor: nwse-resize;
}

.settings-panel-resize-handle.is-sw {
  @apply bottom-0 left-0;

  cursor: nesw-resize;
}

.settings-panel-resize-handle.is-se::after {
  @apply absolute bottom-1 right-1 size-2 opacity-60;

  content: '';
  border-bottom: 1px solid var(--muted-foreground);
  border-right: 1px solid var(--muted-foreground);
}
</style>
