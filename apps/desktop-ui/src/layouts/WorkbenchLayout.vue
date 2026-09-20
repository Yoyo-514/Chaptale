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
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';

import { AppScrollArea } from '@/components/AppScrollArea';
import { AssetDialogs, AssetPanel, StructurePanel, StoryDialogs } from '@/features/assets';
import { useEditorStore } from '@/features/editor';
import { ReferencePanel, useLibraryStore, WorkspaceSearch } from '@/features/library';
import { MemoryPanel } from '@/features/memory-review';
import { ReviewPanel, ReviewCenter } from '@/features/reviews';
import { RunPanel, RunDetails } from '@/features/runs';
import { SettlementPanel, SettlementDialogs } from '@/features/settlement';
import { CreateAssetDialog } from '@/features/templates';
import { VersionDialogs } from '@/features/versions';
import { useWorkbenchStore } from '@/features/workbench';
import {
  NewWorkspaceDialog,
  WorkspaceActionDialogs,
  WorkspaceExplorer,
  useFileTreeStore,
  useWorkspaceStore
} from '@/features/workspace';
import { CandidatePanel, WritingDialogs } from '@/features/writing';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import AgentPanel from './AgentPanel.vue';
import CreativeCenter from './CreativeCenter.vue';
import WritingFlowStrip from './WritingFlowStrip.vue';

type AuxiliaryView = ReturnType<typeof useWorkbenchStore>['auxiliary'];
/** 右栏标签按职责分三组：对话、当前章节的写作流程、回看。组间以细线分隔，窄栏时非当前标签只留图标。 */
const auxiliaryGroups: ReadonlyArray<ReadonlyArray<{ id: AuxiliaryView; label: string; icon: string }>> = [
  [{ id: 'agent', label: 'Agent', icon: 'i-mingcute-chat-3-line' }],
  [
    { id: 'references', label: '参考', icon: 'i-mingcute-bookmark-line' },
    { id: 'candidates', label: '候选', icon: 'i-mingcute-quill-pen-line' },
    { id: 'review', label: '审查', icon: 'i-mingcute-check-circle-line' },
    { id: 'settlement', label: '结算', icon: 'i-mingcute-inbox-2-line' }
  ],
  [
    { id: 'assets', label: '资产', icon: 'i-mingcute-box-3-line' },
    { id: 'runs', label: '运行', icon: 'i-mingcute-history-line' }
  ]
];
const flowViews = new Set<AuxiliaryView>(['references', 'candidates', 'review', 'settlement']);

const editor = useEditorStore();
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const library = useLibraryStore();
const navigation = useWorkbenchStore();
const auxiliaryTabs = ref<{ $el: HTMLElement }>();
const sidebarPanel = ref<InstanceType<typeof SplitterPanel>>();
const auxiliaryPanel = ref<InstanceType<typeof SplitterPanel>>();
const compactQuery = window.matchMedia('(max-width: 760px)');
function syncViewport() {
  navigation.isCompact = compactQuery.matches;
}
function syncPanels() {
  if (navigation.sidebarOpen && !navigation.focusMode) sidebarPanel.value?.expand();
  else sidebarPanel.value?.collapse();
  if (navigation.auxiliaryOpen && !navigation.focusMode) auxiliaryPanel.value?.expand();
  else auxiliaryPanel.value?.collapse();
}
watch(() => [navigation.sidebarOpen, navigation.auxiliaryOpen, navigation.focusMode], syncPanels, { flush: 'post' });
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && navigation.focusMode) navigation.focusMode = false;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    navigation.showSidebar('search');
  }
}
watch(
  () => navigation.auxiliary,
  async () => {
    await nextTick();
    auxiliaryTabs.value?.$el
      .querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  syncViewport();
  compactQuery.addEventListener('change', syncViewport);
  void nextTick(syncPanels);
  window.addEventListener('keydown', onWindowKeydown);
  if (!hasDesktopApi()) return;
  unsubscribe = getDesktopApi().workspace?.onChanged?.(event => {
    if (event.rootPath !== workspace.rootPath) return;
    void tree.applyChanges(event.changes);
    void editor.handleWorkspaceChanged(event);
    if (library.snapshot) void library.refresh();
  });
});
onBeforeUnmount(() => {
  compactQuery.removeEventListener('change', syncViewport);
  unsubscribe?.();
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<template>
  <SplitterGroup
    id="creative-workbench"
    direction="horizontal"
    auto-save-id="chaptale-creative-workbench"
    class="workbench-layout"
    :class="{ 'is-compact': navigation.isCompact }"
  >
    <SplitterPanel
      ref="sidebarPanel"
      id="workbench-primary-sidebar"
      :order="1"
      :default-size="20"
      :min-size="15"
      :max-size="30"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
      :data-compact-hidden="navigation.focusMode || navigation.compactPane !== 'sidebar'"
      :inert="
        !navigation.sidebarOpen ||
        navigation.focusMode ||
        (navigation.isCompact && navigation.compactPane !== 'sidebar')
      "
      @collapse="!navigation.focusMode && (navigation.sidebarOpen = false)"
      @expand="!navigation.focusMode && (navigation.sidebarOpen = true)"
    >
      <aside
        v-show="navigation.sidebarOpen && !navigation.focusMode"
        class="workbench-primary-sidebar"
        aria-label="作品侧栏"
      >
        <div v-show="navigation.sidebar === 'workspace'" class="workbench-sidebar-view">
          <WorkspaceExplorer @open-file="editor.openDocument" />
        </div>
        <ReviewCenter v-if="navigation.sidebar === 'review'" />
        <StructurePanel v-if="navigation.sidebar === 'structure'" />
        <WorkspaceSearch v-if="navigation.sidebar === 'search'" />
        <MemoryPanel v-if="navigation.sidebar === 'memory'" />
      </aside>
    </SplitterPanel>

    <SplitterResizeHandle
      v-show="navigation.sidebarOpen && !navigation.focusMode && !navigation.isCompact"
      class="workbench-resize-handle"
      aria-label="调整作品侧栏宽度"
    />

    <SplitterPanel
      id="workbench-editor"
      :order="2"
      :default-size="52"
      :min-size="35"
      class="workbench-panel"
      :data-compact-hidden="!navigation.focusMode && navigation.compactPane !== 'editor'"
      :inert="navigation.isCompact && !navigation.focusMode && navigation.compactPane !== 'editor'"
    >
      <main class="workbench-editor" aria-label="编辑器区域">
        <CreativeCenter />
      </main>
    </SplitterPanel>

    <SplitterResizeHandle
      v-show="navigation.auxiliaryOpen && !navigation.focusMode && !navigation.isCompact"
      class="workbench-resize-handle"
      aria-label="调整辅助栏宽度"
    />

    <SplitterPanel
      ref="auxiliaryPanel"
      id="workbench-auxiliary-bar"
      :order="3"
      :default-size="28"
      :min-size="22"
      :max-size="45"
      :collapsed-size="0"
      collapsible
      class="workbench-panel"
      :data-compact-hidden="navigation.focusMode || navigation.compactPane !== 'auxiliary'"
      :inert="
        !navigation.auxiliaryOpen ||
        navigation.focusMode ||
        (navigation.isCompact && navigation.compactPane !== 'auxiliary')
      "
      @collapse="!navigation.focusMode && (navigation.auxiliaryOpen = false)"
      @expand="!navigation.focusMode && (navigation.auxiliaryOpen = true)"
    >
      <aside
        v-show="navigation.auxiliaryOpen && !navigation.focusMode"
        class="workbench-auxiliary-bar"
        aria-label="辅助栏"
      >
        <TabsRoot v-model="navigation.auxiliary" class="workbench-auxiliary-root">
          <div class="workbench-auxiliary-header">
            <AppScrollArea orientation="horizontal" class="workbench-tab-scroll">
              <TabsList ref="auxiliaryTabs" class="workbench-auxiliary-tabs" aria-label="辅助栏视图">
                <template v-for="(group, index) in auxiliaryGroups" :key="index">
                  <span v-if="index > 0" class="workbench-auxiliary-divider" aria-hidden="true" />
                  <TabsTrigger
                    v-for="item in group"
                    :key="item.id"
                    class="workbench-auxiliary-tab"
                    :value="item.id"
                    :aria-label="item.label"
                    :title="item.label"
                  >
                    <span :class="item.icon" class="workbench-auxiliary-tab-icon" aria-hidden="true" />
                    <span class="workbench-auxiliary-tab-label">{{ item.label }}</span>
                  </TabsTrigger>
                </template>
              </TabsList>
            </AppScrollArea>
          </div>
          <WritingFlowStrip v-if="flowViews.has(navigation.auxiliary)" />
          <TabsContent
            value="agent"
            force-mount
            v-show="navigation.auxiliary === 'agent'"
            class="workbench-auxiliary-content"
            ><AgentPanel
          /></TabsContent>
          <TabsContent value="references" class="workbench-auxiliary-content"><ReferencePanel /></TabsContent>
          <TabsContent value="candidates" class="workbench-auxiliary-content"><CandidatePanel /></TabsContent>
          <TabsContent value="review" class="workbench-auxiliary-content"><ReviewPanel /></TabsContent>
          <TabsContent value="settlement" class="workbench-auxiliary-content"><SettlementPanel /></TabsContent>
          <TabsContent value="assets" class="workbench-auxiliary-content"><AssetPanel /></TabsContent>
          <TabsContent value="runs" class="workbench-auxiliary-content"><RunPanel /></TabsContent>
        </TabsRoot>
      </aside>
    </SplitterPanel>
  </SplitterGroup>
  <WritingDialogs />
  <NewWorkspaceDialog />
  <WorkspaceActionDialogs />
  <CreateAssetDialog />
  <SettlementDialogs />
  <AssetDialogs />
  <StoryDialogs />
  <VersionDialogs />
  <RunDetails />
</template>

<style scoped lang="scss">
.workbench-layout {
  @apply min-w-0 flex-1 overflow-hidden;

  background: var(--mica-background);
}

.workbench-panel {
  @apply min-w-0 overflow-hidden;
}

.workbench-layout.is-compact {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr);
}
.is-compact > .workbench-panel {
  grid-area: 1 / 1;
  width: 100%;
}
.is-compact > .workbench-panel[data-compact-hidden='true'] {
  display: none;
}

.workbench-primary-sidebar,
.workbench-editor,
.workbench-auxiliary-bar {
  @apply flex h-full min-w-0 flex-col overflow-hidden;
}

.workbench-sidebar-view {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden;
}

.workbench-primary-sidebar {
  background: var(--sidebar);
}
// 右栏是工作流面板而非索引：用比侧栏浅一级的表面，与编辑器区分层次。
.workbench-auxiliary-bar {
  background: var(--surface);
  container-type: inline-size;
  container-name: auxiliary-bar;
}

.workbench-auxiliary-header {
  @apply flex h-9 shrink-0 items-center border-b;
  border-color: var(--border-subtle);
}
.workbench-tab-scroll {
  @apply h-9 min-w-0 flex-1;
}
.workbench-auxiliary-tabs {
  @apply flex h-9 w-max min-w-full shrink-0 items-stretch gap-0.5 px-1.5;
}
.workbench-auxiliary-divider {
  @apply mx-1 my-auto h-4 w-px shrink-0;
  background: var(--border);
}

.workbench-auxiliary-root,
.workbench-auxiliary-content {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none;
}

.workbench-auxiliary-tab {
  @apply relative flex h-full shrink-0 items-center gap-1.5 border-0 bg-transparent px-2 outline-none disabled:opacity-45;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
  transition:
    color var(--motion-duration) ease-out,
    background-color var(--motion-duration) ease-out;
}
.workbench-auxiliary-tab-icon {
  @apply size-4 shrink-0;
}
.workbench-auxiliary-tab-label {
  @apply whitespace-nowrap;
}
.workbench-auxiliary-tab:hover {
  color: var(--foreground);
  background: var(--surface-hover);
}
.workbench-auxiliary-tab[data-state='active'] {
  color: var(--foreground);
  font-weight: 600;
}
.workbench-auxiliary-tab[data-state='active'] .workbench-auxiliary-tab-icon {
  color: var(--primary-solid);
}
.workbench-auxiliary-tab[data-state='active']::after {
  @apply absolute inset-x-1.5 bottom-0 h-0.5;
  content: '';
  background: var(--primary-solid);
}
.workbench-auxiliary-tab:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
// 栏宽不够放下七个带字标签时，非当前标签只留图标；标签文案仍在 DOM 里供读屏与测试定位。
@container auxiliary-bar (max-width: 420px) {
  .workbench-auxiliary-tab:not([data-state='active']) .workbench-auxiliary-tab-label {
    @apply sr-only;
  }
  .workbench-auxiliary-tab:not([data-state='active']) {
    @apply px-2.5;
  }
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
