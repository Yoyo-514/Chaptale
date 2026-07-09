<script setup lang="ts">
import { onMounted } from 'vue';

import AppButton from '@/components/AppButton/AppButton.vue';
import { useSettingsStore } from '@/stores/settings';
import SettingsSidebar from './components/SettingsSidebar.vue';
import type { ResizeDirection } from './composables/useDraggablePanel';
import { useDraggablePanel } from './composables/useDraggablePanel';
import ConfigFilesSettings from './sections/ConfigFilesSettings.vue';
import LLMSettings from './sections/LLMSettings.vue';
import WebAccessSettings from './sections/WebAccessSettings.vue';
import WorkspaceSettings from './sections/WorkspaceSettings.vue';

const resizeDirections: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const settingsStore = useSettingsStore();
const {
  panelStyle,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handleResizePointerDown,
  handleResizePointerMove,
  handleResizePointerUp
} = useDraggablePanel({
  initialX: 88,
  initialY: 72,
  initialWidth: 832,
  initialHeight: 544,
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
  <Teleport to="body">
    <div v-if="settingsStore.isOpen" class="settings-panel-layer">
      <section class="settings-panel" :style="panelStyle" aria-labelledby="settings-panel-title">
        <header
          class="settings-panel-header"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="handlePointerUp"
          @pointercancel="handlePointerUp"
        >
          <div>
            <h2 id="settings-panel-title" class="settings-panel-title">设置</h2>
          </div>
          <AppButton
            icon
            variant="ghost"
            size="sm"
            type="button"
            aria-label="关闭设置"
            @click="settingsStore.closePanel()"
          >
            <span class="i-mingcute-close-line size-4" aria-hidden="true" />
          </AppButton>
        </header>

        <div class="settings-panel-shell">
          <SettingsSidebar />

          <main class="settings-panel-content">
            <WorkspaceSettings v-if="settingsStore.activeSection === 'workspace'" />
            <LLMSettings v-else-if="settingsStore.activeSection === 'llm'" />
            <WebAccessSettings v-else-if="settingsStore.activeSection === 'webAccess'" />
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
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.settings-panel-layer {
  @apply fixed inset-0 z-40 pointer-events-none;
}

.settings-panel {
  @apply pointer-events-auto fixed left-0 top-0 flex flex-col overflow-hidden border shadow-float;

  background: var(--popover);
  border-color: var(--border);
  border-radius: calc(var(--radius) * 0.75);
  color: var(--popover-foreground);
}

.settings-panel-header {
  @apply flex cursor-move items-start justify-between gap-4 border-b px-4 py-3 select-none;

  border-color: var(--border-subtle);
}

.settings-panel-title {
  @apply m-0 text-base font-semibold;
}

.settings-panel-shell {
  @apply grid min-h-0 flex-1 grid-cols-[13.5rem_minmax(0,1fr)];
}

.settings-panel-content {
  @apply min-h-0 overflow-hidden p-2;
}

.settings-panel-resize-handle {
  @apply absolute z-10 block;
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
