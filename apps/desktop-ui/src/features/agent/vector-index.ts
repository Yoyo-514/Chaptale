import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { VectorIndexStatus } from '@chaptale/agent-host/protocol';

import { useCreationStore } from '@/features/creation';
import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi } from '@/utils/desktop-api';

/** 各作品语义检索索引的状态：打开索引弹层时读取，建立期间随宿主事件更新。 */
export const useVectorIndexStore = defineStore('vector-index', () => {
  const statuses = ref<Record<string, VectorIndexStatus>>({});
  const host = () => getDesktopApi().agentHost;

  /** 宿主送来的进度。建立结束时通知作者：失败给出原因，全部算完报告完成；作者自己停止的不通知。 */
  function apply(status: VectorIndexStatus) {
    const wasRunning = statuses.value[status.workId]?.running;
    statuses.value[status.workId] = status;
    if (!wasRunning || status.running) return;
    const title = useCreationStore().works.find(work => work.id === status.workId)?.title ?? '';
    if (status.error) useNotificationStore().error(`《${title}》的索引没有建完`, status.error);
    else if (status.indexed >= status.total)
      useNotificationStore().success(`《${title}》的索引已建好`, `共 ${status.total} 段`);
  }

  async function refresh(workId: string) {
    statuses.value[workId] = await host().request('vectorIndex', { workId });
  }

  async function build(workId: string, rebuild: boolean) {
    statuses.value[workId] = await host().request('buildVectorIndex', { workId, rebuild });
  }

  async function cancel(workId: string) {
    statuses.value[workId] = await host().request('cancelVectorIndex', { workId });
  }

  return { statuses, apply, refresh, build, cancel };
});
