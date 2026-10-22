<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useCreationStore } from '@/features/creation';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import { useEditorStore } from '../store';
import DocumentView from './DocumentView.vue';
import UnsavedDocumentsDialog from './UnsavedDocumentsDialog.vue';

const editor = useEditorStore();
const creation = useCreationStore();
const primary = computed(() => editor.tabs.find(tab => tab.id === editor.activeId));
const secondary = computed(() => editor.tabs.find(tab => tab.id === creation.view?.secondaryDocumentId));
function split() {
  if (!creation.view) return;
  creation.view.secondaryDocumentId = secondary.value
    ? null
    : (editor.tabs.find(tab => tab.id !== editor.activeId)?.id ?? null);
}
function keydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) void editor.saveAll();
    else void editor.saveDocument();
  }
  if (event.key.toLowerCase() === 'w' && editor.activeTab) {
    event.preventDefault();
    event.stopPropagation();
    void editor.closeTab(editor.activeTab.id);
  }
}
let offClose: (() => void) | undefined;
onMounted(() => {
  window.addEventListener('keydown', keydown);
  window.addEventListener('beforeunload', editor.handleBeforeUnload);
  if (hasDesktopApi())
    offClose = getDesktopApi().windowControl.onCloseRequested(() => {
      void editor.requestWindowClose();
    });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('beforeunload', editor.handleBeforeUnload);
  offClose?.();
});
</script>

<template>
  <TabsRoot
    :model-value="editor.activeId"
    class="editor-group"
    @update:model-value="value => editor.selectTab(String(value))"
  >
    <div class="editor-tabbar">
      <AppScrollArea orientation="horizontal" class="editor-tab-scroll">
        <TabsList class="editor-tabs" aria-label="文档标签">
          <div
            v-for="tab in editor.tabs"
            :key="tab.id"
            class="editor-tab-shell"
            :class="{ selected: tab.id === editor.activeId }"
          >
            <TabsTrigger
              :id="`document-tab-${tab.id}`"
              :value="tab.id"
              class="editor-tab"
              :aria-label="`${tab.title}${tab.dirty ? '（未保存）' : ''}`"
              :aria-busy="tab.saving || undefined"
              :title="`${tab.title}${tab.dirty ? '（未保存）' : ''}`"
              @keydown.delete.prevent="editor.closeTab(tab.id)"
            >
              <span class="tab-title">{{ tab.title }}</span>
              <span v-if="secondary?.id === tab.id" class="tab-location">右侧</span>
            </TabsTrigger>
            <AppButton
              icon
              size="xs"
              variant="ghost"
              class="editor-tab-close"
              :class="{ 'is-dirty': tab.dirty }"
              :aria-label="`关闭 ${tab.title}`"
              :title="tab.dirty ? '关闭（未保存）' : '关闭'"
              @click="editor.closeTab(tab.id)"
              ><span class="i-mingcute-close-line tab-close-icon" aria-hidden="true"
            /></AppButton>
          </div>
        </TabsList>
      </AppScrollArea>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        :disabled="editor.tabs.length < 2"
        :aria-label="secondary ? '关闭分栏' : '并排查看'"
        :selected="Boolean(secondary)"
        @click="split"
        ><span class="i-mingcute-layout-right-line" aria-hidden="true"
      /></AppButton>
    </div>
    <div v-if="!editor.tabs.length" class="editor-empty">
      <h2>{{ creation.work?.title }}</h2>
      <p>选择一份文稿或资料开始编辑。</p>
      <AppButton @click="creation.newEntry = { kind: 'document', parentId: null }">{{
        creation.view?.section === 'resource' ? '新建资料' : '新建文稿'
      }}</AppButton>
    </div>
    <div v-else class="editor-panes" :class="{ split: secondary }">
      <section
        v-for="(tab, index) in [primary, secondary].filter(Boolean)"
        :key="tab!.id"
        class="editor-pane"
        :aria-label="index ? '右侧文档' : '当前文档'"
        @focusin="editor.focusedId = tab!.id"
      >
        <DocumentView
          v-if="tab!.status === 'ready'"
          :key="`${tab!.id}:${tab!.generation}`"
          :tab="tab!"
          :active="editor.activeTab?.id === tab!.id"
        />
        <div v-else-if="tab!.status === 'loading'" class="editor-empty" role="status">正在读取文档…</div>
        <div v-else class="editor-empty" role="alert">
          <p>{{ tab!.error }}</p>
          <AppButton @click="editor.reloadDocument(tab!.id)">重新读取</AppButton>
        </div>
      </section>
    </div>
  </TabsRoot>
  <UnsavedDocumentsDialog />
</template>

<style scoped>
.editor-group {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--background);
}
.editor-tabbar {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 36px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-muted);
}
.editor-tab-scroll {
  flex: 1;
  min-width: 0;
}
.editor-tabs {
  display: flex;
  width: max-content;
  height: 35px;
}
.editor-tab-shell {
  display: flex;
  align-items: center;
  padding-inline: 4px;
  border-right: 1px solid var(--border-subtle);
  color: var(--muted-foreground);
}
.editor-tab-shell.selected {
  background: var(--background);
  color: var(--foreground);
}
.editor-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 100%;
  max-width: 240px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.editor-tab:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-location {
  font-size: 12px;
  color: var(--muted-foreground);
}
.editor-tab-close {
  position: relative;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
}
.editor-tab-shell.selected .editor-tab-close,
.editor-tab-shell:hover .editor-tab-close,
.editor-tab-shell:focus-within .editor-tab-close,
.editor-tab-close.is-dirty {
  opacity: 1;
  pointer-events: auto;
}
.editor-tab-close.is-dirty::before {
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.editor-tab-close.is-dirty .tab-close-icon {
  visibility: hidden;
}
.editor-tab-shell:hover .editor-tab-close.is-dirty::before,
.editor-tab-close:focus-visible::before {
  display: none;
}
.editor-tab-shell:hover .editor-tab-close .tab-close-icon,
.editor-tab-close:focus-visible .tab-close-icon {
  visibility: visible;
}
.editor-tabbar span[aria-hidden='true'] {
  display: block;
  width: 14px;
  height: 14px;
}
.editor-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.editor-panes.split {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.editor-pane {
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.editor-pane + .editor-pane {
  border-left: 1px solid var(--border-subtle);
}
.editor-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--muted-foreground);
}
.editor-empty h2 {
  margin: 0;
  color: var(--foreground);
  font-size: 18px;
  font-weight: 500;
}
.editor-empty p {
  margin: 0;
}
</style>
