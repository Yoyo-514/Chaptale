import { defineStore } from 'pinia';
import { onScopeDispose, ref, shallowRef, watch } from 'vue';

import type { Document, Entry, TrashBatch, TrashImpact } from '@chaptale/creation/contracts';

import { toErrorMessage } from '@/utils/desktop-api';

import { requestCreation, useCreationStore } from './store';

/** 当前作品的回收站：列表随作品目录事件刷新，预览只读。 */
export const useTrashStore = defineStore('creation-trash', () => {
  const creation = useCreationStore();
  const batches = ref<TrashBatch[]>([]);
  const open = ref(false);
  const error = ref('');
  /** 主区的只读预览；打开文档或审阅标签时由编辑区清除。 */
  const preview = shallowRef<{ batchId: string; document: Document } | null>(null);
  let request = 0;

  async function refresh() {
    const id = creation.workId;
    const current = ++request;
    if (!id) {
      batches.value = [];
      return;
    }
    const next = await requestCreation('listTrash', { workId: id });
    if (current !== request) return;
    batches.value = next;
    if (preview.value && !next.some(batch => batch.id === preview.value!.batchId)) preview.value = null;
  }
  function report(cause: unknown) {
    error.value = toErrorMessage(cause);
  }
  watch(
    () => creation.workId,
    () => {
      preview.value = null;
      void refresh().catch(report);
    },
    { immediate: true }
  );
  const off = creation.onEvent(event => {
    if (event.change.kind !== 'entries' || event.cursor.workId !== creation.workId) return;
    void refresh().catch(report);
  });
  onScopeDispose(off);

  function impact(entryIds: string[]): Promise<TrashImpact> {
    return requestCreation('previewTrash', { workId: creation.workId!, entryIds });
  }
  async function trash(entryIds: string[]): Promise<Entry[]> {
    const trashed = await requestCreation('trashEntries', {
      commandId: crypto.randomUUID(),
      workId: creation.workId!,
      entryIds
    });
    await Promise.all([creation.refreshEntries(), refresh()]);
    return trashed;
  }
  async function restore(batchId: string) {
    await requestCreation('restoreTrash', { commandId: crypto.randomUUID(), workId: creation.workId!, batchId });
    if (preview.value?.batchId === batchId) preview.value = null;
    await Promise.all([creation.refreshEntries(), refresh()]);
  }
  /** batchId 为 null 时清空整个回收站。 */
  async function purge(batchId: string | null) {
    await requestCreation('purgeTrash', { commandId: crypto.randomUUID(), workId: creation.workId!, batchId });
    if (batchId === null || preview.value?.batchId === batchId) preview.value = null;
    await refresh();
  }
  async function show(batchId: string, entry: Entry) {
    error.value = '';
    try {
      const document = await requestCreation('readTrashedDocument', { workId: creation.workId!, documentId: entry.id });
      preview.value = { batchId, document };
    } catch (cause) {
      report(cause);
    }
  }

  return { batches, open, error, preview, refresh, impact, trash, restore, purge, show };
});
