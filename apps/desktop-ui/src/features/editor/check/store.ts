import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type { CreationEvent, SourceReview } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore, useTrashStore } from '@/features/creation';
import { useWorkbenchStore } from '@/features/workbench';
import { toErrorMessage } from '@/utils/desktop-api';

import { useHistoryStore } from '../history/store';
import { useReviewStore } from '../review/store';

/** 一章的核对标签；revisionId 为打开时看到的正文修订，整章确认绑定它。 */
export interface CheckTab {
  chapterId: string;
  workId: string;
  revisionId: string;
  busy: boolean;
  error: string;
}

/**
 * 来源复核：各章待核对的事件与关系建立／结束，以及“核对 章名”标签。
 * 复核状态由作品服务按修订正文比较得出，章节保存与记录、关系变化后重取。
 */
export const useCheckStore = defineStore('check', () => {
  const creation = useCreationStore();
  const review = useReviewStore();
  const reviews = shallowRef<SourceReview[]>([]);
  const tabs = shallowRef<CheckTab[]>([]);
  const activeId = ref('');
  const activeTab = computed(() => tabs.value.find(tab => tab.chapterId === activeId.value) ?? null);

  let loading: Promise<void> | null = null;
  let stale = false;
  /** 读取进行中再次请求时，结束后补读一次。 */
  function refresh(): Promise<void> {
    if (loading) {
      stale = true;
      return loading;
    }
    const workId = creation.workId;
    if (!workId) {
      reviews.value = [];
      return Promise.resolve();
    }
    loading = requestCreation('listSourceReviews', { workId })
      .then(result => {
        if (creation.workId === workId) reviews.value = result;
      })
      .catch(cause => {
        creation.error = toErrorMessage(cause);
      })
      .finally(() => {
        loading = null;
        if (stale) {
          stale = false;
          void refresh();
        }
      });
    return loading;
  }
  /** 全部待核对的事件与建立／结束 ID，供资料页标“已改过”。 */
  const changedIds = computed(() => new Set(reviews.value.flatMap(item => [...item.recordIds, ...item.milestoneIds])));
  function reviewOf(chapterId: string): SourceReview | null {
    return reviews.value.find(item => item.chapterId === chapterId) ?? null;
  }
  function countOf(chapterId: string): number {
    const item = reviewOf(chapterId);
    return item ? item.recordIds.length + item.milestoneIds.length : 0;
  }

  function find(chapterId: string) {
    return tabs.value.find(tab => tab.chapterId === chapterId);
  }
  function patch(chapterId: string, fields: Partial<CheckTab>) {
    tabs.value = tabs.value.map(tab => (tab.chapterId === chapterId ? { ...tab, ...fields } : tab));
  }
  function open(chapterId: string) {
    useWorkbenchStore().focusEditor();
    if (!find(chapterId)) {
      const chapter = creation.entries.find(entry => entry.id === chapterId)!;
      tabs.value = [
        ...tabs.value,
        { chapterId, workId: creation.workId!, revisionId: chapter.revisionId, busy: false, error: '' }
      ];
    }
    select(chapterId);
  }
  function select(chapterId: string) {
    review.activeId = '';
    useHistoryStore().activeId = '';
    useTrashStore().preview = null;
    activeId.value = chapterId;
  }
  function close(chapterId: string) {
    tabs.value = tabs.value.filter(tab => tab.chapterId !== chapterId);
    if (activeId.value === chapterId) activeId.value = '';
  }
  /** 本章记录仍适用：绑定打开时看到的修订后关闭标签；期间正文又改过的，确认后仍待核对。 */
  async function confirm(chapterId: string) {
    const tab = find(chapterId)!;
    patch(chapterId, { busy: true, error: '' });
    try {
      await requestCreation('confirmChapter', {
        commandId: crypto.randomUUID(),
        workId: tab.workId,
        chapterId,
        revisionId: tab.revisionId
      });
      await refresh();
      close(chapterId);
    } catch (cause) {
      if (find(chapterId)) patch(chapterId, { busy: false, error: toErrorMessage(cause) });
    }
  }

  const offEvent = creation.onEvent((event: CreationEvent) => {
    if (event.cursor.workId !== creation.workId) return;
    const { kind } = event.change;
    if (kind === 'record' || kind === 'records' || kind === 'relation' || kind === 'entries') void refresh();
    else if (kind === 'entry' && event.change.entry.section === 'manuscript') void refresh();
  });
  watch(
    () => creation.workId,
    () => {
      tabs.value = [];
      activeId.value = '';
      reviews.value = [];
      void refresh();
    },
    { immediate: true }
  );
  watch(
    () => [review.activeId, useHistoryStore().activeId, useTrashStore().preview] as const,
    ([reviewing, history, preview]) => {
      if (reviewing || history || preview) activeId.value = '';
    }
  );
  // 章节进入回收站后关闭其核对标签。
  watch(
    () => creation.entries,
    entries => {
      for (const tab of tabs.value) if (!entries.some(entry => entry.id === tab.chapterId)) close(tab.chapterId);
    }
  );
  onScopeDispose(() => offEvent());

  return { reviews, changedIds, tabs, activeId, activeTab, refresh, reviewOf, countOf, open, select, close, confirm };
});
