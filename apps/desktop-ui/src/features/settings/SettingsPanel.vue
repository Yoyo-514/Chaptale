<script setup lang="ts">
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { defineAsyncComponent, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useDraggablePanel, type ResizeDirection } from '@/composables';
import { CloudSyncSettings } from '@/features/cloud-sync';
import { ContentSettings } from '@/features/content';

import SettingsSidebar from './components/SettingsSidebar.vue';
import { useSettingsStore } from './store';

const WorkspaceSettings = defineAsyncComponent(() => import('./sections/WorkspaceSettings.vue'));
const LLMSettings = defineAsyncComponent(() => import('./sections/LLMSettings.vue'));
const PromptSettings = defineAsyncComponent(() => import('./sections/PromptSettings.vue'));
const WebToolsSettings = defineAsyncComponent(() => import('./sections/WebToolsSettings.vue'));
const PermissionsSettings = defineAsyncComponent(() => import('./sections/PermissionsSettings.vue'));
const ConfigFilesSettings = defineAsyncComponent(() => import('./sections/ConfigFilesSettings.vue'));

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
  initialWidth: 920,
  initialHeight: 620,
  minX: 16,
  minY: 16,
  minWidth: 680,
  minHeight: 420,
  viewportPadding: 16
});

onMounted(() => {
  if (settingsStore.isOpen && !settingsStore.state) {
    void settingsStore.load();
  }

  if (settingsStore.isOpen && !settingsStore.models) {
    void settingsStore.loadModels();
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
                <WorkspaceSettings v-if="settingsStore.activeSection === 'workspace'" />
                <LLMSettings v-else-if="settingsStore.activeSection === 'llm'" />
                <PromptSettings v-else-if="settingsStore.activeSection === 'prompt'" />
                <WebToolsSettings v-else-if="settingsStore.activeSection === 'webTools'" />
                <PermissionsSettings v-else-if="settingsStore.activeSection === 'permissions'" />
                <CloudSyncSettings v-else-if="settingsStore.activeSection === 'cloudSync'" />
                <ContentSettings v-else-if="settingsStore.activeSection === 'content'" />
                <ConfigFilesSettings v-else />
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

@container settings-panel (max-width: 40rem) {
  .settings-panel-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
}
</style>
