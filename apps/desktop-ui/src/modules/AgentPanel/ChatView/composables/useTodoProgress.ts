import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { TodoItem } from '@chaptale/shared';

import { getDesktopApi, hasDesktopApi } from '@/stores/utils/desktop-api';

/**
 * 当前会话的 todo 进度：切换会话时全量拉取，之后跟随 main 侧整表推送增量更新。
 *
 * 数据源是 todo_write 工具落盘的清单，renderer 只读展示不做修改。
 */
export function useTodoProgress(getSessionId: () => string) {
  const items = ref<TodoItem[]>([]);

  const total = computed(() => items.value.length);
  const completedCount = computed(() => items.value.filter(item => item.status === 'completed').length);
  const visible = computed(() => items.value.length > 0);

  // 浏览器 e2e/dev 环境没有桌面 API：保持静态空态，不订阅不拉取。
  if (!hasDesktopApi()) {
    return { items, total, completedCount, visible };
  }

  async function refresh() {
    const sessionId = getSessionId();

    if (!sessionId) {
      items.value = [];
      return;
    }

    items.value = await getDesktopApi().todos.get(sessionId);
  }

  watch(getSessionId, () => void refresh(), { immediate: true });

  const unsubscribe = getDesktopApi().todos.onUpdated(event => {
    if (event.sessionId === getSessionId()) {
      items.value = event.items;
    }
  });
  onBeforeUnmount(unsubscribe);

  return { items, total, completedCount, visible };
}
