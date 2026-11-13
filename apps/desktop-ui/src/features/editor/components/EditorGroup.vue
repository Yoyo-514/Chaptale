<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTextView } from '@/components/AppTextView';
import { useCreationStore, useTrashStore } from '@/features/creation';
import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useCheckStore } from '../check/store';
import { useHistoryStore } from '../history/store';
import { useReviewStore } from '../review/store';
import { useEditorStore } from '../store';
import EditorGroupPane from './EditorGroupPane.vue';
import UnsavedDocumentsDialog from './UnsavedDocumentsDialog.vue';

const editor = useEditorStore();
const review = useReviewStore();
const history = useHistoryStore();
const check = useCheckStore();
const creation = useCreationStore();
const trash = useTrashStore();

const isSplit = computed(() => editor.groups.length === 2);
const hasAnyContent = computed(
  () => editor.tabs.length > 0 || review.tabs.length > 0 || history.tabs.length > 0 || check.tabs.length > 0
);

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

function keydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return;
  const specialActive = editor.isSpecialActiveInGroup(editor.activeGroup);
  const reviewing = specialActive ? review.activeTab : undefined;
  const viewing = specialActive ? history.activeTab : undefined;
  const checking = specialActive ? check.activeTab : undefined;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) void editor.saveAll();
    else if (reviewing) void review.save(reviewing.key);
    else if (viewing || checking) return;
    else void editor.saveDocument();
  }
  if (event.key.toLowerCase() === 'w' && (reviewing || viewing || checking || editor.activeTab)) {
    event.preventDefault();
    event.stopPropagation();
    if (reviewing) review.close(reviewing.key);
    else if (viewing) history.close(viewing.documentId);
    else if (checking) check.close(checking.chapterId);
    else void editor.closeTab(editor.activeTab!.id, editor.activeGroup);
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
  <div class="editor-group">
    <section v-if="trash.preview" class="trash-preview" aria-label="回收站预览">
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

    <div v-else-if="!hasAnyContent" class="editor-empty">
      <h2>{{ creation.work?.title }}</h2>
      <p>选择一份文稿或资料开始编辑。</p>
      <AppButton @click="creation.newEntry = { kind: 'document', parentId: null }">{{
        creation.view?.section === 'resource' ? '新建资料' : '新建文稿'
      }}</AppButton>
    </div>

    <SplitterGroup v-else id="editor-groups-split" direction="horizontal" class="editor-groups-split">
      <SplitterPanel :order="1" :default-size="isSplit ? 50 : 100" :min-size="25" class="editor-group-panel">
        <EditorGroupPane :group-index="0" :is-split="isSplit" :focused="editor.activeGroup === 0" />
      </SplitterPanel>
      <template v-if="isSplit">
        <SplitterResizeHandle class="editor-split-handle" aria-label="调整编辑分栏宽度" />
        <SplitterPanel :order="2" :default-size="50" :min-size="25" class="editor-group-panel">
          <EditorGroupPane :group-index="1" :is-split="true" :focused="editor.activeGroup === 1" />
        </SplitterPanel>
      </template>
    </SplitterGroup>
  </div>
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
.editor-groups-split {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.editor-group-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.editor-split-handle {
  position: relative;
  width: 1px;
  flex-shrink: 0;
  background: var(--border-subtle);
}
.editor-split-handle::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
  z-index: 1;
}
.editor-split-handle:hover,
.editor-split-handle[data-state='drag'] {
  background: var(--ring);
}
.trash-preview {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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
