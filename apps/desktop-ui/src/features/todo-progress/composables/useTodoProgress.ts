import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { TodoItem } from '@chaptale/shared';

import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

/** 无桌面 API 分支的占位动作：签名与主分支一致，供浏览器 e2e/dev 环境复用。 */
function noopClear(): Promise<boolean> {
  return Promise.resolve(false);
}

/**
 * 当前会话的 todo 进度：切换会话时全量拉取，之后跟随 main 侧整表推送增量更新。
 *
 * 数据源是 todo_write 工具落盘的清单；renderer 除展示外提供手动清理：
 * 清空全部与清空已完成（走 todos.clear IPC，成功后按返回值刷新）。
 */
export function useTodoProgress(getSessionId: () => string) {
  const items = ref<TodoItem[]>([]);
  const isClearing = ref(false);

  const total = computed(() => items.value.length);
  const completedCount = computed(() => items.value.filter(item => item.status === 'completed').length);
  const visible = computed(() => items.value.length > 0);

  // 浏览器 e2e/dev 环境没有桌面 API：保持静态空态，不订阅不拉取。
  if (!hasDesktopApi()) {
    return { items, isClearing, total, completedCount, visible, clearAll: noopClear, clearCompleted: noopClear };
  }

  async function refresh() {
    const sessionId = getSessionId();

    if (!sessionId) {
      items.value = [];
      return;
    }

    try {
      const fetched = await getDesktopApi().todos.get(sessionId);

      // 等待响应期间会话可能已切换，晚到的旧响应不落地。
      if (getSessionId() === sessionId) {
        items.value = fetched;
      }
    } catch {
      // 主进程异常时回到空列表，避免面板静默假死；错误细节交给全局兜底。
      if (getSessionId() === sessionId) {
        items.value = [];
      }
    }
  }

  async function runClear(scope: 'all' | 'completed') {
    const sessionId = getSessionId();

    if (!sessionId || isClearing.value) {
      return false;
    }

    isClearing.value = true;

    try {
      const next = await getDesktopApi().todos.clear({ sessionId, scope });

      // 整表推送与返回值语义一致；会话切换后晚到的响应不落地。
      if (getSessionId() === sessionId) {
        items.value = next;
      }

      return true;
    } catch {
      // 清理失败保持当前清单；错误细节交给全局兜底。
      return false;
    } finally {
      isClearing.value = false;
    }
  }

  watch(getSessionId, () => void refresh(), { immediate: true });

  const unsubscribe = getDesktopApi().todos.onUpdated(event => {
    if (event.sessionId === getSessionId()) {
      items.value = event.items;
    }
  });
  onBeforeUnmount(unsubscribe);

  return {
    items,
    isClearing,
    total,
    completedCount,
    visible,
    clearAll: () => runClear('all'),
    clearCompleted: () => runClear('completed')
  };
}
