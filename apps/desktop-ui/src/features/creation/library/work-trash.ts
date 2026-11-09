import { defineStore } from 'pinia';
import { onScopeDispose, ref, watch } from 'vue';

import type { TrashedWork } from '@chaptale/creation/contracts';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { requestCreation } from '../request';
import { useCreationStore } from '../store';

function impact(workId: string): Promise<{ pendingCount: number }> {
  return requestCreation('previewTrashWork', { workId });
}

/** 作品库回收站：列表随作品库事件刷新。 */
export const useWorkTrashStore = defineStore('creation-work-trash', () => {
  const creation = useCreationStore();
  const works = ref<TrashedWork[]>([]);
  const open = ref(false);
  const error = ref('');

  async function refresh() {
    works.value = await requestCreation('listTrashedWorks', {});
  }
  function report(cause: unknown) {
    error.value = toErrorMessage(cause);
  }
  watch(
    () => creation.connected,
    connected => {
      if (connected) void refresh().catch(report);
    },
    { immediate: true }
  );
  const off = creation.onEvent(event => {
    if (event.change.kind === 'library') void refresh().catch(report);
  });
  onScopeDispose(off);

  async function restore(workId: string) {
    await requestCreation('restoreWork', { commandId: crypto.randomUUID(), workId });
    await Promise.all([creation.refreshLibrary(), refresh()]);
  }
  async function purge(workId: string) {
    // 宿主关闭并移走该作品的会话历史，平台把作品与会话目录移入回收站。
    await getDesktopApi().agentHost.request('purgeWork', { commandId: crypto.randomUUID(), workId });
    await refresh();
  }

  return { works, open, error, refresh, impact, restore, purge };
});
