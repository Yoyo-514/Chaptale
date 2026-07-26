import { onBeforeUnmount, ref, watch } from 'vue';

import type { PermissionAskEvent, PermissionDecideArgs } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/**
 * 当前会话的待授权请求队列：切换会话时全量拉取，之后跟随 main 侧 ask 推送追加。
 *
 * 决策提交后立即从本地队列移除；请求已在 main 侧超时/被处理（accepted=false）时
 * 同样移除，避免用户对过期请求反复操作。
 */
export function usePermissionRequests(getSessionId: () => string) {
  const requests = ref<PermissionAskEvent[]>([]);
  const isSubmitting = ref(false);
  const notificationStore = useNotificationStore();

  // 浏览器 e2e/dev 环境没有桌面 API：保持静态空态，不订阅不拉取。
  if (!hasDesktopApi()) {
    return { requests, isSubmitting, decide: async () => undefined };
  }

  async function refresh() {
    const sessionId = getSessionId();

    if (!sessionId) {
      requests.value = [];
      return;
    }

    const fetched = await getDesktopApi().permissions.getPending(sessionId);

    // 等待响应期间会话可能已切换，晚到的旧响应不落地。
    if (getSessionId() === sessionId) {
      requests.value = fetched;
    }
  }

  watch(getSessionId, () => void refresh(), { immediate: true });

  const unsubscribe = getDesktopApi().permissions.onAsk(event => {
    if (event.sessionId === getSessionId() && !requests.value.some(item => item.requestId === event.requestId)) {
      requests.value = [...requests.value, event];
    }
  });
  onBeforeUnmount(unsubscribe);

  async function decide(args: PermissionDecideArgs) {
    isSubmitting.value = true;

    try {
      const result = await getDesktopApi().permissions.decide(args);

      if (!result.accepted) {
        notificationStore.info('授权请求已失效', '该请求可能已超时或在其他窗口中处理');
        requests.value = requests.value.filter(item => item.requestId !== args.requestId);
        return;
      }

      if (args.decision.outcome === 'allow-always') {
        notificationStore.success(
          '已添加工作区授权规则',
          `${args.decision.pattern} · 保存于 .chaptale/permissions.json`
        );
      }

      requests.value = requests.value.filter(item => item.requestId !== args.requestId);
    } catch (error) {
      notificationStore.error('提交授权决定失败', toErrorMessage(error));
    } finally {
      isSubmitting.value = false;
    }
  }

  return { requests, isSubmitting, decide };
}
