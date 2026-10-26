<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useCreationStore } from '@/features/creation';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import { useReviewStore } from '../review/store';
import { useEditorStore } from '../store';
import DocumentView from './DocumentView.vue';
import ReviewPane from './ReviewPane.vue';
import UnsavedDocumentsDialog from './UnsavedDocumentsDialog.vue';

const editor = useEditorStore();
const review = useReviewStore();
const creation = useCreationStore();
/** 文档与审阅标签共用一个标签栏；审阅标签值带前缀，选中时占用主栏。 */
const selected = computed(() => (review.activeTab ? `review:${review.activeTab.changeId}` : editor.activeId));
function select(value: string) {
  if (value.startsWith('review:')) review.select(value.slice('review:'.length));
  else editor.selectTab(value);
}
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
  const reviewing = review.activeTab;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) void editor.saveAll();
    else if (reviewing) void review.save(reviewing.changeId);
    else void editor.saveDocument();
  }
  if (event.key.toLowerCase() === 'w' && (reviewing || editor.activeTab)) {
    event.preventDefault();
    event.stopPropagation();
    if (reviewing) review.close(reviewing.changeId);
    else void editor.closeTab(editor.activeTab!.id);
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
  <TabsRoot :model-value="selected" class="editor-group" @update:model-value="value => select(String(value))">
    <div class="editor-tabbar">
      <AppScrollArea orientation="horizontal" class="editor-tab-scroll">
        <TabsList class="editor-tabs" aria-label="文档标签">
          <div
            v-for="tab in editor.tabs"
            :key="tab.id"
            class="editor-tab-shell"
            :class="{ selected: tab.id === selected }"
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
          <div
            v-for="tab in review.tabs"
            :key="`review:${tab.changeId}`"
            class="editor-tab-shell"
            :class="{ selected: `review:${tab.changeId}` === selected }"
          >
            <TabsTrigger
              :id="`review-tab-${tab.changeId}`"
              :value="`review:${tab.changeId}`"
              class="editor-tab"
              :aria-label="`审阅 ${tab.title}${tab.dirty ? '（手改未保存）' : ''}`"
              :title="`审阅 ${tab.title}${tab.dirty ? '（手改未保存）' : ''}`"
              @keydown.delete.prevent="review.close(tab.changeId)"
            >
              <span class="i-mingcute-git-compare-line tab-kind-icon" aria-hidden="true" />
              <span class="tab-title">{{ tab.title }}</span>
            </TabsTrigger>
            <AppButton
              icon
              size="xs"
              variant="ghost"
              class="editor-tab-close"
              :class="{ 'is-dirty': tab.dirty }"
              :aria-label="`关闭审阅 ${tab.title}`"
              :title="tab.dirty ? '关闭（手改未保存）' : '关闭'"
              @click="review.close(tab.changeId)"
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
    <div v-if="review.activeTab" class="editor-panes">
      <section class="editor-pane" aria-label="审阅">
        <ReviewPane
          v-if="review.activeTab.status === 'ready'"
          :key="`${review.activeTab.changeId}:${review.activeTab.generation}`"
          :tab="review.activeTab"
        />
        <div v-else-if="review.activeTab.status === 'loading'" class="editor-empty" role="status">
          正在读取待接受修改…
        </div>
        <div v-else class="editor-empty" role="alert">
          <p>{{ review.activeTab.error }}</p>
        </div>
      </section>
    </div>
    <div v-else-if="!editor.tabs.length" class="editor-empty">
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
.tab-kind-icon {
  flex-shrink: 0;
  color: var(--warning);
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
