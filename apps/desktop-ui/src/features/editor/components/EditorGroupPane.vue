<script setup lang="ts">
import { TabsList, TabsRoot } from 'reka-ui';
import { computed } from 'vue';

import type { EditorGroupIndex } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu } from '@/components/AppContextMenu';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useCreationStore } from '@/features/creation';

import CheckPane from '../check/CheckPane.vue';
import { useCheckStore } from '../check/store';
import HistoryPane from '../history/HistoryPane.vue';
import { useHistoryStore } from '../history/store';
import ReadingView from '../reading/ReadingView.vue';
import { useReadingStore } from '../reading/store';
import ReviewPane from '../review/ReviewPane.vue';
import { reviewDone, useReviewStore } from '../review/store';
import { useEditorStore } from '../store';
import type { EditorTab as EditorTabModel } from '../types';
import DocumentView from './DocumentView.vue';
import EditorTab from './EditorTab.vue';

const props = defineProps<{
  groupIndex: EditorGroupIndex;
  isSplit: boolean;
  focused: boolean;
}>();

const editor = useEditorStore();
const review = useReviewStore();
const reading = useReadingStore();
const history = useHistoryStore();
const check = useCheckStore();
const creation = useCreationStore();

const groupState = computed(() => editor.groups[props.groupIndex]);
const groupTabs = computed(() =>
  (groupState.value?.tabs ?? [])
    .map(item => editor.tabs.find(tab => tab.id === item.documentId))
    .filter((tab): tab is EditorTabModel => Boolean(tab))
);
const ownsSpecialTabs = computed(() => !props.isSplit || editor.specialGroup === props.groupIndex);
const specialActive = computed(() => editor.isSpecialActiveInGroup(props.groupIndex));

const selected = computed(() => {
  if (specialActive.value) {
    if (review.activeTab) return `review:${review.activeTab.key}`;
    if (history.activeTab) return `history:${history.activeTab.documentId}`;
    if (check.activeTab) return `check:${check.activeTab.chapterId}`;
  }
  return groupState.value?.activeDocumentId ?? '';
});

const activeDoc = computed(() =>
  specialActive.value ? undefined : groupTabs.value.find(tab => tab.id === groupState.value?.activeDocumentId)
);
const readingSlot = computed(() => (activeDoc.value ? reading.slotKey(props.groupIndex, activeDoc.value.id) : ''));
const isReading = computed(() => Boolean(activeDoc.value && reading.positions[readingSlot.value]));

const checkCount = computed(() => (activeDoc.value && !specialActive.value ? check.countOf(activeDoc.value.id) : 0));

function select(value: string) {
  editor.focusGroup(props.groupIndex);
  if (value.startsWith('review:')) {
    editor.specialGroup = props.groupIndex;
    review.select(value.slice('review:'.length));
  } else if (value.startsWith('history:')) {
    editor.specialGroup = props.groupIndex;
    history.select(value.slice('history:'.length));
  } else if (value.startsWith('check:')) {
    editor.specialGroup = props.groupIndex;
    check.select(value.slice('check:'.length));
  } else {
    editor.selectTab(value, props.groupIndex);
  }
}

function tabMenu(id: string) {
  const chapter = creation.entries.find(entry => entry.id === id)?.section === 'manuscript';
  return [
    ...(!props.isSplit || props.groupIndex === 0 ? [{ id: 'splitRight', label: '向右拆分' }] : []),
    { id: 'history', label: '查看历史', separatorBefore: !props.isSplit || props.groupIndex === 0 },
    ...(chapter ? [{ id: 'extract', label: '从本章提取' }] : []),
    ...(check.countOf(id) ? [{ id: 'check', label: '核对本章记录' }] : []),
    { id: 'close', label: '关闭', separatorBefore: true }
  ];
}

function tabAction(id: string, action: string) {
  editor.focusGroup(props.groupIndex);
  if (action === 'splitRight') editor.splitRight(id, props.groupIndex);
  else if (action === 'history') history.open(id);
  else if (action === 'check') check.open(id);
  else if (action === 'extract') void editor.extractChapter(editor.tabs.find(tab => tab.id === id)!);
  else void editor.closeTab(id, props.groupIndex);
}

function openHistory() {
  if (!activeDoc.value) return;
  editor.focusGroup(props.groupIndex);
  history.open(activeDoc.value.id);
}

function openCheck() {
  if (!activeDoc.value) return;
  editor.focusGroup(props.groupIndex);
  check.open(activeDoc.value.id);
}
</script>

<template>
  <section
    class="editor-group-pane"
    :class="{ 'is-focused': focused, 'is-split': isSplit }"
    :aria-label="isSplit ? (groupIndex === 0 ? '左侧编辑组' : '右侧编辑组') : '编辑组'"
    @mousedown="editor.focusGroup(groupIndex)"
    @focusin="editor.focusGroup(groupIndex)"
  >
    <TabsRoot
      :model-value="selected"
      class="editor-group-tabs-root"
      @update:model-value="value => select(String(value))"
    >
      <div class="editor-tabbar">
        <AppScrollArea orientation="horizontal" class="editor-tab-scroll">
          <TabsList
            class="editor-tabs"
            :aria-label="isSplit ? (groupIndex === 0 ? '左侧文档标签' : '右侧文档标签') : '文档标签'"
          >
            <AppContextMenu
              v-for="tab in groupTabs"
              :key="tab.id"
              :items="tabMenu(tab.id)"
              @select="action => tabAction(tab.id, action)"
            >
              <EditorTab
                kind="document"
                :value="tab.id"
                :trigger-id="`document-tab-${groupIndex}-${tab.id}`"
                :title="tab.title"
                :selected="tab.id === selected"
                :dirty="tab.dirty"
                :busy="tab.saving"
                @close="editor.closeTab(tab.id, groupIndex)"
              />
            </AppContextMenu>
            <template v-if="ownsSpecialTabs">
              <EditorTab
                v-for="tab in review.tabs"
                :key="`review:${tab.key}`"
                :kind="reviewDone(tab) ? 'document' : 'review'"
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
              <EditorTab
                v-for="tab in check.tabs"
                :key="`check:${tab.chapterId}`"
                kind="check"
                :value="`check:${tab.chapterId}`"
                :trigger-id="`check-tab-${tab.chapterId}`"
                :title="creation.entries.find(entry => entry.id === tab.chapterId)?.title ?? ''"
                :selected="`check:${tab.chapterId}` === selected"
                @close="check.close(tab.chapterId)"
              />
            </template>
          </TabsList>
        </AppScrollArea>
        <AppButton
          v-if="checkCount"
          size="xs"
          variant="ghost"
          class="check-chip"
          title="本章正文改过，出自本章的记录需要核对"
          @click="openCheck"
          ><span class="i-mingcute-alert-line check-chip-icon" aria-hidden="true" />本章
          {{ checkCount }} 条记录待核对</AppButton
        >
        <AppButton
          icon
          size="xs"
          variant="ghost"
          :disabled="!activeDoc || activeDoc.status !== 'ready' || isReading || specialActive"
          aria-label="阅读"
          title="阅读"
          @click="reading.start(activeDoc!.id, groupIndex)"
          ><span class="i-mingcute-book-6-line" aria-hidden="true"
        /></AppButton>
        <AppButton
          icon
          size="xs"
          variant="ghost"
          :disabled="!activeDoc || specialActive"
          aria-label="查看历史"
          title="查看历史"
          @click="openHistory"
          ><span class="i-mingcute-history-line" aria-hidden="true"
        /></AppButton>
        <AppButton
          v-if="!isSplit || groupIndex === 0"
          icon
          size="xs"
          variant="ghost"
          :disabled="!activeDoc || specialActive"
          aria-label="向右拆分"
          title="向右拆分"
          @click="editor.splitRight(activeDoc!.id, groupIndex)"
          ><span class="i-mingcute-layout-right-line" aria-hidden="true"
        /></AppButton>
      </div>

      <div v-if="specialActive && review.activeTab" class="editor-pane-host">
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
      <div v-else-if="specialActive && check.activeTab" class="editor-pane-host">
        <section class="editor-pane" aria-label="核对">
          <CheckPane :key="check.activeTab.chapterId" :tab="check.activeTab" />
        </section>
      </div>
      <div v-else-if="specialActive && history.activeTab" class="editor-pane-host">
        <section class="editor-pane" aria-label="历史">
          <HistoryPane v-if="history.activeTab.status === 'ready'" :tab="history.activeTab" />
          <div v-else-if="history.activeTab.status === 'loading'" class="editor-empty" role="status">正在读取历史…</div>
          <div v-else class="editor-empty" role="alert">
            <p>{{ history.activeTab.error }}</p>
          </div>
        </section>
      </div>
      <div v-else-if="activeDoc" class="editor-pane-host">
        <section class="editor-pane" :aria-label="isSplit ? (groupIndex === 0 ? '左侧文档' : '右侧文档') : '当前文档'">
          <ReadingView
            v-if="activeDoc.status === 'ready' && isReading"
            :key="`reading:${groupIndex}:${activeDoc.id}`"
            :tab="activeDoc"
            :group-index="groupIndex"
          />
          <DocumentView
            v-else-if="activeDoc.status === 'ready'"
            :key="`${groupIndex}:${activeDoc.id}:${activeDoc.generation}`"
            :tab="activeDoc"
            :group-index="groupIndex"
            :active="focused && editor.activeTab?.id === activeDoc.id"
          />
          <div v-else-if="activeDoc.status === 'loading'" class="editor-empty" role="status">正在读取文档…</div>
          <div v-else class="editor-empty" role="alert">
            <p>{{ activeDoc.error }}</p>
            <AppButton @click="editor.reloadDocument(activeDoc.id)">重新读取</AppButton>
          </div>
        </section>
      </div>
    </TabsRoot>
  </section>
</template>

<style scoped>
.editor-group-pane,
.editor-group-tabs-root {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--background);
}
.editor-group-pane.is-split:not(.is-focused) .editor-tabbar {
  opacity: 0.78;
}
.check-chip {
  gap: 4px;
  margin-right: 4px;
  color: var(--warning);
}
.check-chip-icon {
  width: 14px;
  height: 14px;
}
.editor-tabbar {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 36px;
  padding-right: 4px;
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
.editor-pane-host,
.editor-pane {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
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
.editor-empty p {
  margin: 0;
}
</style>
