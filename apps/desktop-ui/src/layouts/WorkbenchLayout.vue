<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';

import AgentPanel from './AgentPanel.vue';
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
        <header class="workbench-panel-header">
          <span>工作区</span>
        </header>
        <div class="workbench-placeholder">
          <span class="i-mingcute-folder-2-line workbench-placeholder-icon" aria-hidden="true" />
          <p>作品文件将显示在这里</p>
        </div>
      </aside>
    </SplitterPanel>

    <SplitterResizeHandle class="workbench-resize-handle" aria-label="调整工作区侧栏宽度" />

    <SplitterPanel id="workbench-editor" :default-size="52" :min-size="35" class="workbench-panel">
      <main class="workbench-editor" aria-label="编辑器区域">
        <div class="workbench-editor-tabs" role="tablist" aria-label="编辑器标签">
          <div class="workbench-editor-tab" role="tab" aria-selected="true">欢迎</div>
        </div>
        <section class="workbench-editor-empty">
          <span class="i-mingcute-book-6-line workbench-editor-empty-icon" aria-hidden="true" />
          <h1>创作工作台</h1>
          <p>从左侧选择作品文件，在这里开始写作。</p>
        </section>
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
        <div class="workbench-auxiliary-tabs" role="tablist" aria-label="辅助栏视图">
          <button class="workbench-auxiliary-tab is-active" type="button" role="tab" aria-selected="true">Agent</button>
          <button class="workbench-auxiliary-tab" type="button" role="tab" aria-selected="false" disabled>参考</button>
          <button class="workbench-auxiliary-tab" type="button" role="tab" aria-selected="false" disabled>审查</button>
        </div>
        <AgentPanel />
      </aside>
    </SplitterPanel>
  </SplitterGroup>
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

.workbench-panel-header,
.workbench-editor-tabs,
.workbench-auxiliary-tabs {
  @apply flex h-9 shrink-0 items-center border-b px-3 text-xs;

  border-color: var(--border-subtle);
}

.workbench-panel-header {
  @apply font-semibold uppercase tracking-wide;

  color: var(--muted-foreground);
}

.workbench-placeholder {
  @apply flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs;

  color: var(--muted-foreground);
}

.workbench-placeholder-icon {
  @apply size-7 opacity-70;
}

.workbench-editor-tabs {
  @apply p-0;

  background: var(--surface-acrylic-subtle);
}

.workbench-editor-tab {
  @apply flex h-full min-w-28 items-center border-r px-3;

  border-color: var(--border-subtle);
  background: var(--mica-background);
  color: var(--foreground);
}

.workbench-editor-empty {
  @apply flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center;

  color: var(--muted-foreground);
}

.workbench-editor-empty-icon {
  @apply mb-1 size-10 opacity-55;
}

.workbench-editor-empty h1 {
  @apply text-base font-medium;

  color: var(--foreground);
}

.workbench-editor-empty p {
  @apply text-xs;
}

.workbench-auxiliary-tabs {
  @apply gap-1 px-2;
}

.workbench-auxiliary-tab {
  @apply relative flex h-full items-center border-0 bg-transparent px-2 text-xs outline-none disabled:opacity-45;

  color: var(--muted-foreground);
}

.workbench-auxiliary-tab.is-active {
  color: var(--foreground);
}

.workbench-auxiliary-tab.is-active::after {
  @apply absolute inset-x-2 bottom-0 h-0.5;

  content: '';
  background: var(--primary-solid);
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
