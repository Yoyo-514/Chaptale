import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import type { Document, RevisionSummary } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore, useTrashStore } from '@/features/creation';
import { useWorkbenchStore } from '@/features/workbench';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCheckStore } from '../check/store';
import { useReviewStore } from '../review/store';
import { useEditorStore } from '../store';

export interface HistoryTab {
  documentId: string;
  workId: string;
  title: string;
  /** 当前正式内容；对比与恢复都以它为基准。 */
  current: Document | null;
  revisions: RevisionSummary[];
  selectedId: string | null;
  /** 选中版本的正文。 */
  selectedContent: string | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
  restoring: boolean;
}

/** 只改标题的修订不在列表中，取它当时的正文版本。 */
async function listedAt(workId: string, revisionId: string, revisions: RevisionSummary[]) {
  const { createdAt } = await requestCreation('readRevision', { workId, revisionId });
  return revisions.find(item => item.createdAt <= createdAt)?.id ?? revisions.at(-1)?.id ?? null;
}

/** 章节历史标签：按 Timeline 列出正式修订，选中版本与当前正式内容对比并可恢复。 */
export const useHistoryStore = defineStore('history', () => {
  const creation = useCreationStore();
  const review = useReviewStore();
  const tabs = shallowRef<HistoryTab[]>([]);
  const activeId = ref('');
  const activeTab = computed(() => tabs.value.find(tab => tab.documentId === activeId.value) ?? null);

  function find(id: string) {
    return tabs.value.find(tab => tab.documentId === id);
  }
  function patch(id: string, fields: Partial<HistoryTab>) {
    tabs.value = tabs.value.map(tab => (tab.documentId === id ? { ...tab, ...fields } : tab));
  }

  async function load(id: string) {
    const tab = find(id)!;
    try {
      const [current, revisions] = await Promise.all([
        requestCreation('readDocument', { workId: tab.workId, documentId: id }),
        requestCreation('listRevisions', { workId: tab.workId, documentId: id })
      ]);
      if (!find(id)) return;
      const preset = find(id)!.selectedId;
      const selectedId =
        preset === null
          ? (revisions[1]?.id ?? revisions[0]?.id ?? null)
          : revisions.some(item => item.id === preset)
            ? preset
            : await listedAt(tab.workId, preset, revisions);
      if (!find(id)) return;
      patch(id, { current, revisions, title: current.title, status: 'ready', error: '' });
      if (selectedId) await selectRevision(id, selectedId);
    } catch (cause) {
      if (find(id)) patch(id, { status: 'error', error: toErrorMessage(cause) });
    }
  }
  async function selectRevision(id: string, revisionId: string) {
    const tab = find(id)!;
    patch(id, { selectedId: revisionId });
    try {
      const revision = await requestCreation('readRevision', { workId: tab.workId, revisionId });
      if (find(id)?.selectedId === revisionId) patch(id, { selectedContent: revision.snapshot.content, error: '' });
    } catch (cause) {
      if (find(id)) patch(id, { error: toErrorMessage(cause) });
    }
  }
  /** 打开历史并预选某个修订与当前正文对比，供核对标签“查看本章改动”使用。 */
  function compare(documentId: string, revisionId: string) {
    const existing = find(documentId);
    if (existing) {
      select(documentId);
      void selectRevision(documentId, revisionId);
      return;
    }
    open(documentId);
    patch(documentId, { selectedId: revisionId });
  }
  function open(documentId: string) {
    useWorkbenchStore().focusEditor();
    const entry = creation.entries.find(item => item.id === documentId)!;
    if (!find(documentId)) {
      tabs.value = [
        ...tabs.value,
        {
          documentId,
          workId: creation.workId!,
          title: entry.title,
          current: null,
          revisions: [],
          selectedId: null,
          selectedContent: null,
          status: 'loading',
          error: '',
          restoring: false
        }
      ];
      void load(documentId);
    }
    select(documentId);
  }
  function select(id: string) {
    review.activeId = '';
    useCheckStore().activeId = '';
    useTrashStore().preview = null;
    activeId.value = id;
  }
  function close(id: string) {
    tabs.value = tabs.value.filter(tab => tab.documentId !== id);
    if (activeId.value === id) activeId.value = '';
  }
  /** 恢复前先处理该章未保存输入；用选中版本的正文保存为新修订，标题与格式保持当前值。 */
  async function restore(id: string) {
    const editor = useEditorStore();
    const tab = find(id)!;
    if (editor.tabs.some(item => item.id === id) && !(await editor.confirmClose([id]))) return;
    patch(id, { restoring: true, error: '' });
    try {
      const current = await requestCreation('readDocument', { workId: tab.workId, documentId: id });
      await requestCreation('saveDocument', {
        commandId: crypto.randomUUID(),
        workId: tab.workId,
        documentId: id,
        expectedRevisionId: current.revisionId,
        title: current.title,
        format: current.format,
        content: find(id)!.selectedContent!
      });
      await editor.openDocument(id);
    } catch (cause) {
      if (find(id)) patch(id, { error: toErrorMessage(cause) });
    } finally {
      if (find(id)) patch(id, { restoring: false });
    }
  }

  watch(
    () => creation.workId,
    () => {
      tabs.value = [];
      activeId.value = '';
    }
  );
  watch(
    () => review.activeId,
    id => {
      if (id) activeId.value = '';
    }
  );
  watch(
    () => useTrashStore().preview,
    preview => {
      if (preview) activeId.value = '';
    }
  );
  // 保存或恢复产生新修订后刷新列表；条目进入回收站时标签显示读取错误。
  watch(
    () => creation.entries,
    () => {
      for (const tab of tabs.value) {
        const entry = creation.entries.find(item => item.id === tab.documentId);
        if (tab.current && entry?.revisionId !== tab.current.revisionId) void load(tab.documentId);
      }
    }
  );

  return { tabs, activeId, activeTab, open, compare, select, close, selectRevision, restore };
});
