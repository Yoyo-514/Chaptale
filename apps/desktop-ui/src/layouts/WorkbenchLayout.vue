<script setup lang="ts">
import {
  SplitterGroup,
  SplitterPanel,
  SplitterResizeHandle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger
} from 'reka-ui';
import { onMounted, onBeforeUnmount } from 'vue';

import { EditorGroup, useEditorStore } from '@/features/editor';
import { ReferencePanel, useLibraryStore } from '@/features/library';
import { ReviewPanel, ReviewCenter } from '@/features/reviews';
import { useWorkbenchStore } from '@/features/workbench';
import { WorkspaceExplorer, useFileTreeStore, useWorkspaceStore } from '@/features/workspace';
import { CandidatePanel, WritingDialogs } from '@/features/writing';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import AgentPanel from './AgentPanel.vue';

const editor = useEditorStore();
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const library = useLibraryStore();
const navigation = useWorkbenchStore();
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  if (!hasDesktopApi()) return;
  unsubscribe = getDesktopApi().workspace?.onChanged?.(event => {
    if (event.rootPath !== workspace.rootPath) return;
    void tree.applyChanges(event.changes);
    void editor.handleWorkspaceChanged(event);
    if (library.snapshot) void library.refresh();
  });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <SplitterGroup
    id="creative-workbench"
    direction="horizontal"
    auto-save-id="chaptale-creative-workbench"
    class="workbench-layout"
  >
    <SplitterPanel
      id="workbench-primary-sidebar"
      :default-size="20"
      :min-size="15"
      :max-size="30"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
    >
      <aside class="workbench-primary-sidebar" aria-label="工作区侧栏">
        <WorkspaceExplorer v-show="navigation.sidebar !== 'review'" @open-file="editor.openDocument" />
        <ReviewCenter v-if="navigation.sidebar === 'review'" />
      </aside>
    </SplitterPanel>

    <SplitterResizeHandle class="workbench-resize-handle" aria-label="调整工作区侧栏宽度" />

    <SplitterPanel id="workbench-editor" :default-size="52" :min-size="35" class="workbench-panel">
      <main class="workbench-editor" aria-label="编辑器区域">
        <EditorGroup />
      </main>
    </SplitterPanel>

    <SplitterResizeHandle class="workbench-resize-handle" aria-label="调整辅助栏宽度" />

    <SplitterPanel
      id="workbench-auxiliary-bar"
      :default-size="28"
      :min-size="22"
      :max-size="45"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
    >
      <aside class="workbench-auxiliary-bar" aria-label="辅助栏">
        <TabsRoot v-model="navigation.auxiliary" class="workbench-auxiliary-root">
          <TabsList class="workbench-auxiliary-tabs" aria-label="辅助栏视图">
            <TabsTrigger class="workbench-auxiliary-tab" value="agent">Agent</TabsTrigger>
            <TabsTrigger class="workbench-auxiliary-tab" value="references">参考</TabsTrigger>
            <TabsTrigger class="workbench-auxiliary-tab" value="candidates">候选</TabsTrigger>
            <TabsTrigger class="workbench-auxiliary-tab" value="review">审查</TabsTrigger>
          </TabsList>
          <TabsContent value="agent" class="workbench-auxiliary-content"><AgentPanel /></TabsContent>
          <TabsContent value="references" class="workbench-auxiliary-content"><ReferencePanel /></TabsContent>
          <TabsContent value="candidates" class="workbench-auxiliary-content"><CandidatePanel /></TabsContent>
          <TabsContent value="review" class="workbench-auxiliary-content"><ReviewPanel /></TabsContent>
        </TabsRoot>
      </aside>
    </SplitterPanel>
  </SplitterGroup>
  <WritingDialogs />
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
.workbench-auxiliary-bar {
  @apply flex h-full min-w-0 flex-col overflow-hidden;
}

.workbench-primary-sidebar,
.workbench-auxiliary-bar {
  background: var(--surface-acrylic-subtle);
}

.workbench-auxiliary-tabs {
  @apply flex h-9 shrink-0 items-center border-b px-3 text-xs;

  border-color: var(--border-subtle);
}

.workbench-auxiliary-root,
.workbench-auxiliary-content {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none;
}

.workbench-auxiliary-tabs {
  @apply gap-1 px-2;
}

.workbench-auxiliary-tab {
  @apply relative flex h-full items-center border-0 bg-transparent px-2 text-xs outline-none disabled:opacity-45;

  color: var(--muted-foreground);
}

.workbench-auxiliary-tab[data-state='active'] {
  color: var(--foreground);
}

.workbench-auxiliary-tab[data-state='active']::after {
  @apply absolute inset-x-2 bottom-0 h-0.5;

  content: '';
  background: var(--primary-solid);
}

.workbench-auxiliary-tab:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.workbench-resize-handle {
  @apply relative w-0.5 shrink-0 outline-none transition-colors;

  background: var(--border-subtle);
}

.workbench-resize-handle::after {
  @apply absolute inset-y-0;

  content: '';
  // 分界线本身细，命中区靠这层补回来：左右各外扩 3px，总计仍是 8px。
  left: -3px;
  right: -3px;
}

.workbench-resize-handle:hover,
.workbench-resize-handle[data-resize-handle-active] {
  background: var(--primary-solid);
}

.workbench-resize-handle:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
