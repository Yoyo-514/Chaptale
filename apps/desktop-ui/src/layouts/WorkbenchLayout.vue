<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { SessionPanel } from '@/features/agent';
import {
  useCreationStore,
  CreationExplorer,
  CreationDialogs,
  FileExchangeDialog,
  WorksLibrary
} from '@/features/creation';
import { EditorGroup } from '@/features/editor';
import { useWorkbenchStore } from '@/features/workbench';
import { hasDesktopApi } from '@/utils/desktop-api';

const creation = useCreationStore();
const navigation = useWorkbenchStore();
const sidebar = ref<InstanceType<typeof SplitterPanel>>();
const auxiliary = ref<InstanceType<typeof SplitterPanel>>();
const showSidebar = computed(
  () => Boolean(creation.workId) && !creation.libraryOpen && navigation.sidebarOpen && !navigation.focusMode
);
const showAuxiliary = computed(
  () => !creation.libraryOpen && navigation.auxiliaryOpen && !navigation.agentInMain && !navigation.focusMode
);
function syncPanels() {
  if (showSidebar.value) sidebar.value?.expand();
  else sidebar.value?.collapse();
  if (showAuxiliary.value) auxiliary.value?.expand();
  else auxiliary.value?.collapse();
}
watch([showSidebar, showAuxiliary], syncPanels, { flush: 'post' });
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') navigation.focusMode = false;
}
onMounted(() => {
  void nextTick(syncPanels);
  window.addEventListener('keydown', keydown);
  if (hasDesktopApi()) void creation.connect();
});
onBeforeUnmount(() => window.removeEventListener('keydown', keydown));
</script>

<template>
  <div class="workbench-shell">
    <div v-if="(creation.error || creation.stateError) && !creation.libraryOpen" class="workbench-error" role="alert">
      {{ creation.error || creation.stateError
      }}<AppButton size="xs" @click="creation.error ? creation.connect() : creation.persistState()">重试</AppButton>
    </div>
    <WorksLibrary v-show="creation.libraryOpen" />
    <SplitterGroup
      id="creative-workbench"
      direction="horizontal"
      class="workbench-layout"
      v-show="!creation.libraryOpen"
    >
      <SplitterPanel
        ref="sidebar"
        :order="1"
        :default-size="22"
        :min-size="16"
        :max-size="35"
        :collapsed-size="0"
        collapsible
        class="workbench-panel"
        :inert="!showSidebar"
      >
        <CreationExplorer v-if="creation.workId" v-show="showSidebar" />
      </SplitterPanel>
      <SplitterResizeHandle v-show="showSidebar" class="workbench-resize-handle" aria-label="调整作品导航宽度" />
      <SplitterPanel :order="2" :default-size="48" :min-size="35" class="workbench-panel">
        <main class="workbench-editor" aria-label="主要工作区">
          <EditorGroup v-show="!navigation.agentInMain" />
          <div id="main-agent-host" v-show="navigation.agentInMain" class="workbench-agent-host" />
        </main>
      </SplitterPanel>
      <SplitterResizeHandle v-show="showAuxiliary" class="workbench-resize-handle" aria-label="调整 Agent 侧栏宽度" />
      <SplitterPanel
        ref="auxiliary"
        :order="3"
        :default-size="30"
        :min-size="25"
        :max-size="50"
        :collapsed-size="0"
        collapsible
        class="workbench-panel"
        :inert="!showAuxiliary"
        ><aside id="side-agent-host" v-show="showAuxiliary" class="workbench-agent-host" aria-label="Agent 侧栏"
      /></SplitterPanel>
    </SplitterGroup>
  </div>
  <Teleport defer :to="navigation.agentInMain ? '#main-agent-host' : '#side-agent-host'"><SessionPanel /></Teleport>
  <CreationDialogs /><FileExchangeDialog />
</template>

<style scoped>
.workbench-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.workbench-layout {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: var(--background);
}
.workbench-panel {
  min-width: 0;
  overflow: hidden;
}
.workbench-editor,
.workbench-agent-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.workbench-resize-handle {
  position: relative;
  width: 1px;
  flex-shrink: 0;
  background: var(--border-subtle);
}
.workbench-resize-handle::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
  z-index: 1;
}
.workbench-resize-handle:hover,
.workbench-resize-handle[data-state='drag'] {
  background: var(--ring);
}
.workbench-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  color: var(--destructive);
  font-size: 12px;
}
</style>
