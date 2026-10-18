<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AppPanelHeader } from '@/components/AppPanel';
import { SessionPanel } from '@/features/agent';
import { EditorGroup, useEditorStore } from '@/features/editor';
import { useWorkbenchStore } from '@/features/workbench';
import {
  NewWorkspaceDialog,
  WorkspaceActionDialogs,
  WorkspaceExplorer,
  useFileTreeStore,
  useWorkspaceStore
} from '@/features/workspace';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

const editor = useEditorStore();
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const navigation = useWorkbenchStore();
const sidebarPanel = ref<InstanceType<typeof SplitterPanel>>();
const auxiliaryPanel = ref<InstanceType<typeof SplitterPanel>>();
function syncPanels() {
  if (navigation.sidebarOpen && !navigation.focusMode) sidebarPanel.value?.expand();
  else sidebarPanel.value?.collapse();
  if (navigation.auxiliaryOpen && !navigation.agentInMain && !navigation.focusMode) auxiliaryPanel.value?.expand();
  else auxiliaryPanel.value?.collapse();
}
watch(
  () => [navigation.sidebarOpen, navigation.auxiliaryOpen, navigation.agentInMain, navigation.focusMode],
  syncPanels,
  { flush: 'post' }
);
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && navigation.focusMode) navigation.focusMode = false;
}
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void nextTick(syncPanels);
  window.addEventListener('keydown', onWindowKeydown);
  if (!hasDesktopApi()) return;
  // 启动时恢复上次打开的作品；文件树只在有作品时挂载，不能由它自己读取。
  void workspace.refreshState();
  unsubscribe = getDesktopApi().workspace.onChanged(event => {
    if (event.rootPath !== workspace.rootPath) return;
    void tree.applyChanges(event.changes);
    void editor.handleWorkspaceChanged(event);
  });
});
onBeforeUnmount(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <SplitterGroup
    id="creative-workbench"
    direction="horizontal"
    auto-save-id="chaptale-workbench"
    class="workbench-layout"
  >
    <SplitterPanel
      ref="sidebarPanel"
      :order="1"
      :default-size="navigation.sidebarOpen ? 22 : 0"
      :min-size="16"
      :max-size="35"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
      :inert="!navigation.sidebarOpen || navigation.focusMode"
      @collapse="!navigation.focusMode && (navigation.sidebarOpen = false)"
      @expand="!navigation.focusMode && (navigation.sidebarOpen = true)"
    >
      <aside
        v-show="navigation.sidebarOpen && !navigation.focusMode"
        class="workbench-primary-sidebar"
        aria-label="作品导航"
      >
        <div class="workbench-explorer">
          <WorkspaceExplorer v-if="workspace.rootPath" @open-file="editor.openDocument" />
          <template v-else
            ><AppPanelHeader title="作品" />
            <p class="workbench-sidebar-empty">打开作品后，在这里浏览章节和资料。</p></template
          >
        </div>
      </aside>
    </SplitterPanel>
    <SplitterResizeHandle
      v-show="navigation.sidebarOpen && !navigation.focusMode"
      class="workbench-resize-handle"
      aria-label="调整作品导航宽度"
    />
    <SplitterPanel :order="2" :default-size="48" :min-size="35" class="workbench-panel">
      <main class="workbench-editor" aria-label="主要工作区">
        <EditorGroup v-show="!navigation.agentInMain" />
        <div id="main-agent-host" v-show="navigation.agentInMain" class="workbench-agent-host" />
      </main>
    </SplitterPanel>
    <SplitterResizeHandle
      v-show="navigation.auxiliaryOpen && !navigation.agentInMain && !navigation.focusMode"
      class="workbench-resize-handle"
      aria-label="调整协作栏宽度"
    />
    <SplitterPanel
      ref="auxiliaryPanel"
      :order="3"
      :default-size="navigation.auxiliaryOpen && !navigation.agentInMain ? 30 : 0"
      :min-size="25"
      :max-size="50"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
      :inert="!navigation.auxiliaryOpen || navigation.agentInMain || navigation.focusMode"
      @collapse="!navigation.focusMode && !navigation.agentInMain && (navigation.auxiliaryOpen = false)"
      @expand="!navigation.focusMode && !navigation.agentInMain && (navigation.auxiliaryOpen = true)"
    >
      <aside
        id="side-agent-host"
        v-show="navigation.auxiliaryOpen && !navigation.agentInMain && !navigation.focusMode"
        class="workbench-agent-host"
        aria-label="协作栏"
      />
    </SplitterPanel>
  </SplitterGroup>
  <!-- 同一组件只移动 DOM，草稿、滚动和唯一输入框始终保留。 -->
  <Teleport defer :to="navigation.agentInMain ? '#main-agent-host' : '#side-agent-host'"><SessionPanel /></Teleport>
  <NewWorkspaceDialog /><WorkspaceActionDialogs />
</template>

<style scoped lang="scss">
.workbench-layout {
  @apply min-w-0 flex-1 overflow-hidden;
  background: var(--mica-background);
}
.workbench-panel {
  @apply min-w-0 overflow-hidden;
}
.workbench-primary-sidebar,
.workbench-editor,
.workbench-agent-host {
  @apply flex h-full min-w-0 flex-col overflow-hidden;
}
.workbench-primary-sidebar {
  background: var(--sidebar);
}
.workbench-explorer {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
}
.workbench-sidebar-empty {
  @apply m-0 px-3 py-4 text-xs leading-relaxed;
  color: var(--muted-foreground);
}
.workbench-agent-host {
  flex: 1;
}
.workbench-resize-handle {
  @apply relative w-px shrink-0;
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
</style>
