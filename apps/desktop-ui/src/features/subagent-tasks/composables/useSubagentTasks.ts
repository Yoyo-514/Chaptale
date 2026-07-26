import { onBeforeUnmount, ref, watch } from 'vue';

import type { SubagentSlotEvent, SubagentSlotSnapshot, SubagentState } from '@chaptale/shared';

import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

export type SubagentTaskEntry = {
  requestId: string;
  personaId: string;
  state: SubagentState;
  usage?: { inputTokens: number; outputTokens: number };
  runId?: string;
  outputRef?: string;
  error?: string;
};

const TERMINAL_STATES: ReadonlySet<SubagentState> = new Set(['success', 'failed', 'cancelled', 'timeout']);

export function isTerminalState(state: SubagentState): boolean {
  return TERMINAL_STATES.has(state);
}

/** 取消子任务；排队中直接出队，运行中立即终结。 */
async function cancel(requestId: string) {
  await getDesktopApi().subagent.cancel(requestId);
}

/**
 * 当前会话的子任务卡片数据：切换会话时拉取活跃快照，之后跟随槽位事件更新。
 *
 * 终态条目保留展示（作者需要看到结果状态与 token 消耗），由用户手动清除；
 * 切换会话时整表重建，不跨会话残留。
 */
export function useSubagentTasks(getSessionId: () => string) {
  const tasks = ref<SubagentTaskEntry[]>([]);

  // 浏览器 e2e/dev 环境没有桌面 API：保持静态空态，不订阅不拉取。
  if (!hasDesktopApi()) {
    return { tasks, cancel: async () => undefined, dismiss: () => undefined };
  }

  async function refresh() {
    const sessionId = getSessionId();

    if (!sessionId) {
      tasks.value = [];
      return;
    }

    const snapshots = await getDesktopApi().subagent.listActive(sessionId);

    // 等待响应期间会话可能已切换，晚到的旧响应不落地。
    if (getSessionId() === sessionId) {
      tasks.value = snapshots.map((snapshot: SubagentSlotSnapshot) => ({
        requestId: snapshot.requestId,
        personaId: snapshot.personaId,
        state: snapshot.state
      }));
    }
  }

  watch(getSessionId, () => void refresh(), { immediate: true });

  const unsubscribe = getDesktopApi().subagent.onEvent((event: SubagentSlotEvent) => {
    if (event.sessionId !== getSessionId()) {
      return;
    }

    const entry: SubagentTaskEntry = {
      requestId: event.requestId,
      personaId: event.personaId,
      state: event.state,
      ...(event.usage ? { usage: event.usage } : {}),
      ...(event.runId ? { runId: event.runId } : {}),
      ...(event.outputRef ? { outputRef: event.outputRef } : {}),
      ...(event.error ? { error: event.error } : {})
    };

    const index = tasks.value.findIndex(task => task.requestId === event.requestId);
    tasks.value = index === -1 ? [...tasks.value, entry] : tasks.value.map((task, i) => (i === index ? entry : task));
  });
  onBeforeUnmount(unsubscribe);

  /** 清除终态条目；非终态条目忽略（取消才是正确出口）。 */
  function dismiss(requestId: string) {
    tasks.value = tasks.value.filter(task => task.requestId !== requestId || !isTerminalState(task.state));
  }

  return { tasks, cancel, dismiss };
}
