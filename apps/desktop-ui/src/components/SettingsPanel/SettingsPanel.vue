<script setup lang="ts">
import { onMounted, reactive } from 'vue';

import { useSettingsStore } from '../../stores/settings';
import ConfigFilesSettings from './sections/ConfigFilesSettings.vue';
import LLMSettings from './sections/LLMSettings.vue';
import WorkspaceSettings from './sections/WorkspaceSettings.vue';
import SettingsSidebar from './SettingsSidebar.vue';

const settingsStore = useSettingsStore();
const position = reactive({ x: 88, y: 72 });
const drag = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

onMounted(() => {
  if (settingsStore.isOpen && !settingsStore.state) {
    void settingsStore.load();
  }

  if (settingsStore.isOpen && !settingsStore.models) {
    void settingsStore.loadModels();
  }
});

function handlePointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('button, input, select, textarea, a')) {
    return;
  }

  drag.active = true;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.originX = position.x;
  drag.originY = position.y;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
  if (!drag.active) {
    return;
  }

  const nextX = drag.originX + event.clientX - drag.startX;
  const nextY = drag.originY + event.clientY - drag.startY;
  position.x = Math.max(56, Math.min(nextX, window.innerWidth - 760));
  position.y = Math.max(44, Math.min(nextY, window.innerHeight - 520));
}

function handlePointerUp(event: PointerEvent) {
  if (!drag.active) {
    return;
  }

  drag.active = false;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="settingsStore.isOpen" class="settings-panel-layer">
      <section
        class="settings-panel"
        :style="{ transform: `translate(${position.x}px, ${position.y}px)` }"
        aria-labelledby="settings-panel-title"
      >
        <header
          class="settings-panel-header"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="handlePointerUp"
          @pointercancel="handlePointerUp"
        >
          <div>
            <h2 id="settings-panel-title" class="settings-panel-title">设置</h2>
            <p class="settings-panel-subtitle">工作区、会话存储、模型与凭据</p>
          </div>
          <button class="settings-close-button" type="button" aria-label="关闭设置" @click="settingsStore.closePanel()">
            <span class="i-mingcute-close-line" aria-hidden="true" />
          </button>
        </header>

        <div class="settings-panel-shell">
          <SettingsSidebar />

          <main class="settings-panel-content">
            <WorkspaceSettings v-if="settingsStore.activeSection === 'workspace'" />
            <LLMSettings v-else-if="settingsStore.activeSection === 'llm'" />
            <ConfigFilesSettings v-else />
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.settings-panel-layer {
  @apply fixed inset-0 z-40 pointer-events-none;
}

.settings-panel {
  @apply pointer-events-auto fixed left-0 top-0 flex max-h-[calc(100vh-5.5rem)] min-h-[34rem] w-[min(52rem,calc(100vw-5rem))] flex-col border shadow-float;

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

.settings-panel-subtitle {
  @apply mt-1 mb-0 text-xs;

  color: var(--muted-foreground);
}

.settings-close-button {
  @apply flex-center size-7 shrink-0 border text-sm outline-none transition-colors duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
}

.settings-close-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.settings-close-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-panel-shell {
  @apply grid min-h-0 flex-1 grid-cols-[13.5rem_minmax(0,1fr)];
}

.settings-panel-content {
  @apply min-h-0 overflow-y-auto p-2;
}
</style>
