<script setup lang="ts">
import { TabsList, TabsRoot } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu } from '@/components/AppContextMenu';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTextView } from '@/components/AppTextView';
import { useCreationStore, useTrashStore } from '@/features/creation';
import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import HistoryPane from '../history/HistoryPane.vue';
import { useHistoryStore } from '../history/store';
import ReadingView from '../reading/ReadingView.vue';
import { useReadingStore } from '../reading/store';
import ReviewPane from '../review/ReviewPane.vue';
import { useReviewStore } from '../review/store';
import { useEditorStore } from '../store';
import DocumentView from './DocumentView.vue';
import EditorTab from './EditorTab.vue';
import UnsavedDocumentsDialog from './UnsavedDocumentsDialog.vue';

const editor = useEditorStore();
const review = useReviewStore();
const reading = useReadingStore();
const history = useHistoryStore();
const creation = useCreationStore();
const trash = useTrashStore();
function restorePreview() {
  trash.restore(trash.preview!.batchId).catch(cause => {
    trash.error = toErrorMessage(cause);
  });
}
watch(
  () => review.activeId,
  id => {
    if (id) trash.preview = null;
  }
);
/** 文档、审阅与历史标签共用一个标签栏；审阅和历史标签值带前缀，选中时占用主栏。 */
const selected = computed(() => {
  if (trash.preview) return '';
  if (review.activeTab) return `review:${review.activeTab.key}`;
  if (history.activeTab) return `history:${history.activeTab.documentId}`;
  return editor.activeId;
});
function select(value: string) {
  if (value.startsWith('review:')) review.select(value.slice('review:'.length));
  else if (value.startsWith('history:')) history.select(value.slice('history:'.length));
  else editor.selectTab(value);
}
function tabMenu(id: string) {
  const chapter = creation.entries.find(entry => entry.id === id)?.section === 'manuscript';
  return [
    { id: 'history', label: '查看历史' },
    ...(chapter ? [{ id: 'extract', label: '从本章提取' }] : []),
    { id: 'close', label: '关闭', separatorBefore: true }
  ];
}
function tabAction(id: string, action: string) {
  if (action === 'history') history.open(id);
  else if (action === 'extract') void editor.extractChapter(editor.tabs.find(tab => tab.id === id)!);
  else void editor.closeTab(id);
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
  const viewing = history.activeTab;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) void editor.saveAll();
    else if (reviewing) void review.save(reviewing.key);
    else if (viewing) return;
    else void editor.saveDocument();
  }
  if (event.key.toLowerCase() === 'w' && (reviewing || viewing || editor.activeTab)) {
    event.preventDefault();
    event.stopPropagation();
    if (reviewing) review.close(reviewing.key);
    else if (viewing) history.close(viewing.documentId);
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
          <AppContextMenu
            v-for="tab in editor.tabs"
            :key="tab.id"
            :items="tabMenu(tab.id)"
            @select="action => tabAction(tab.id, action)"
          >
            <EditorTab
              kind="document"
              :value="tab.id"
              :trigger-id="`document-tab-${tab.id}`"
              :title="tab.title"
              :selected="tab.id === selected"
              :dirty="tab.dirty"
              :busy="tab.saving"
              :location="secondary?.id === tab.id ? '右侧' : undefined"
              @close="editor.closeTab(tab.id)"
            />
          </AppContextMenu>
          <EditorTab
            v-for="tab in review.tabs"
            :key="`review:${tab.key}`"
            kind="review"
            :value="`review:${tab.key}`"
            :trigger-id="`review-tab-${tab.key}`"
            :title="tab.title"
            :selected="`review:${tab.key}` === selected"
            :dirty="tab.dirty"
            @close="review.close(tab.key)"
          />
          <EditorTab
            v-for="tab in history.tabs"
            :key="`history:${tab.documentId}`"
            kind="history"
            :value="`history:${tab.documentId}`"
            :trigger-id="`history-tab-${tab.documentId}`"
            :title="tab.title"
            :selected="`history:${tab.documentId}` === selected"
            @close="history.close(tab.documentId)"
          />
        </TabsList>
      </AppScrollArea>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        :disabled="
          !primary ||
          primary.status !== 'ready' ||
          Boolean(reading.positions[primary.id]) ||
          Boolean(review.activeTab || history.activeTab)
        "
        aria-label="阅读"
        @click="reading.start(primary!.id)"
        ><span class="i-mingcute-book-6-line" aria-hidden="true"
      /></AppButton>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        :disabled="!primary || Boolean(review.activeTab || history.activeTab)"
        aria-label="查看历史"
        title="查看历史"
        @click="history.open(primary!.id)"
        ><span class="i-mingcute-history-line" aria-hidden="true"
      /></AppButton>
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
    <div v-if="trash.preview" class="editor-panes">
      <section class="editor-pane trash-preview" aria-label="回收站预览">
        <header class="trash-preview-bar">
          <span class="i-mingcute-delete-2-line trash-preview-icon" aria-hidden="true" />
          <span class="trash-preview-title">{{ trash.preview.document.title }}</span>
          <span class="trash-preview-note">在回收站中 · 只读</span>
          <AppButton size="xs" @click="restorePreview">恢复</AppButton>
          <AppButton icon size="xs" variant="ghost" aria-label="关闭预览" @click="trash.preview = null"
            ><span class="i-mingcute-close-line size-3.5" aria-hidden="true"
          /></AppButton>
        </header>
        <AppTextView
          :key="trash.preview.document.id"
          class="trash-preview-text"
          :text="trash.preview.document.content"
          :label="`${trash.preview.document.title}（回收站，只读）`"
        />
      </section>
    </div>
    <div v-else-if="review.activeTab" class="editor-panes">
      <section class="editor-pane" aria-label="审阅">
        <ReviewPane
          v-if="review.activeTab.status === 'ready'"
          :key="`${review.activeTab.key}:${review.activeTab.generation}`"
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
    <div v-else-if="history.activeTab" class="editor-panes">
      <section class="editor-pane" aria-label="历史">
        <HistoryPane v-if="history.activeTab.status === 'ready'" :tab="history.activeTab" />
        <div v-else-if="history.activeTab.status === 'loading'" class="editor-empty" role="status">正在读取历史…</div>
        <div v-else class="editor-empty" role="alert">
          <p>{{ history.activeTab.error }}</p>
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
        <ReadingView
          v-if="tab!.status === 'ready' && reading.positions[tab!.id]"
          :key="`reading:${tab!.id}`"
          :tab="tab!"
        />
        <DocumentView
          v-else-if="tab!.status === 'ready'"
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
.trash-preview {
  display: flex;
  flex-direction: column;
}
.trash-preview-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.trash-preview-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.trash-preview-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trash-preview-note {
  flex: 1;
  font-size: 12px;
  color: var(--muted-foreground);
}
.trash-preview-text {
  flex: 1;
  min-height: 0;
}
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
