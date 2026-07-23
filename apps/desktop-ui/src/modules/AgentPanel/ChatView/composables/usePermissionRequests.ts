import { onBeforeUnmount, ref, watch } from 'vue';

import type { PermissionAskEvent, PermissionDecideArgs } from '@chaptale/ipc-contract';

import { getDesktopApi, hasDesktopApi } from '@/stores/utils/desktop-api';

/**
 * 当前会话的待授权请求队列：切换会话时全量拉取，之后跟随 main 侧 ask 推送追加。
 *
 * 决策提交后立即从本地队列移除；请求已在 main 侧超时/被处理（accepted=false）时
 * 同样移除，避免用户对过期请求反复操作。
 */
export function usePermissionRequests(getSessionId: () => string) {
  const requests = ref<PermissionAskEvent[]>([]);
  const isSubmitting = ref(false);

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
      await getDesktopApi().permissions.decide(args);
    } finally {
      isSubmitting.value = false;
      requests.value = requests.value.filter(item => item.requestId !== args.requestId);
    }
  }

  return { requests, isSubmitting, decide };
}
