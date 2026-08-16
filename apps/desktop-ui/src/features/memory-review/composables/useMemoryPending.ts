import { onBeforeUnmount, ref } from 'vue';

import type { MemoryPendingAction, MemoryPendingProposal } from '@chaptale/shared';

import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

/**
 * 待确认的记忆提议列表：挂载时拉取，之后跟随 pendingChanged 信号重新拉取。
 *
 * pending 归属工作区而非会话，切会话不重建；数据始终以主进程落盘为准，
 * 本地不做乐观更新——resolve 后由 changed 信号驱动刷新。
 */
export function useMemoryPending() {
  const proposals = ref<MemoryPendingProposal[]>([]);
  /** 处理结果提示（冲突原因等）；下一次操作或刷新时清除。 */
  const notice = ref('');

  // 浏览器 e2e/dev 环境没有桌面 API：保持静态空态，不订阅不拉取。
  if (!hasDesktopApi()) {
    return { proposals, notice, resolve: async () => undefined, refresh: async () => undefined };
  }

  async function refresh() {
    try {
      const result = await getDesktopApi().memory.listPending();
      proposals.value = result.proposals;
    } catch {
      // 主进程异常时回到空列表，避免面板静默假死；错误细节交给全局兜底。
      proposals.value = [];
    }
  }

  async function resolve(id: string, action: MemoryPendingAction) {
    notice.value = '';

    try {
      const result = await getDesktopApi().memory.resolvePending({ id, action });

      if (result.status === 'conflict' || result.status === 'missing') {
        notice.value = result.message ?? '提议无法处理';
        await refresh();
      }
      // applied/rejected 由 changed 信号驱动刷新，不做本地移除。
    } catch {
      notice.value = '处理失败，请重试';
    }
  }

  const unsubscribe = getDesktopApi().memory.onPendingChanged(() => {
    void refresh();
  });

  void refresh();

  onBeforeUnmount(() => {
    unsubscribe();
  });

  return { proposals, notice, resolve, refresh };
}
