import { computed, ref, watch } from 'vue';

import type { MemoryContextPressureStatus } from '@chaptale/shared';

import { useNotificationStore } from '@/stores/notification';
import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/stores/utils/desktop-api';

/**
 * 会话水位提示与作者确认压缩流程。
 *
 * 水位以主进程/SDK 为事实源；Renderer 只记当前会话的“稍后”选择，切换会话后重置。
 * 压缩成功后由调用方重载会话树，使 pi 写入的 compaction 分支立即显示。
 */
export function useContextCompaction(getSessionId: () => string, onCompacted: () => Promise<void> | void) {
  const notificationStore = useNotificationStore();
  const status = ref<MemoryContextPressureStatus | null>(null);
  const isCompacting = ref(false);
  const dismissedSessionId = ref<string | null>(null);
  const shouldShow = computed(() => Boolean(status.value?.shouldPrompt) && dismissedSessionId.value !== getSessionId());

  async function refresh() {
    const sessionId = getSessionId();

    if (!sessionId || !hasDesktopApi()) {
      status.value = null;
      return;
    }

    try {
      const next = await getDesktopApi().agent.getContextPressure(sessionId);

      // 请求期间可能切换会话，晚到响应不得污染新会话。
      if (getSessionId() === sessionId) {
        status.value = next;
      }
    } catch {
      // 水位提示是增强能力，查询失败不应阻断聊天主流程。
      status.value = null;
    }
  }

  function dismiss() {
    dismissedSessionId.value = getSessionId();
  }

  async function compact() {
    const sessionId = getSessionId();

    if (!sessionId || isCompacting.value || !hasDesktopApi()) {
      return;
    }

    isCompacting.value = true;

    try {
      const result = await getDesktopApi().agent.compactSession(sessionId);

      // 压缩期间切换会话时仍完成落盘，但不重载当前界面为旧会话。
      if (getSessionId() === sessionId) {
        dismissedSessionId.value = sessionId;
        status.value = null;
        await onCompacted();
      }

      notificationStore.success('会话已压缩', `摘要已保存到 ${result.summaryRef}`);
    } catch (error) {
      notificationStore.error('会话压缩失败', toErrorMessage(error));
    } finally {
      isCompacting.value = false;
    }
  }

  watch(
    getSessionId,
    (sessionId, previousSessionId) => {
      if (sessionId !== previousSessionId) {
        dismissedSessionId.value = null;
        status.value = null;
      }

      void refresh();
    },
    { immediate: true }
  );

  return { status, shouldShow, isCompacting, refresh, dismiss, compact };
}
