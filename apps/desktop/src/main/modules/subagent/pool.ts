import type { SubagentSlotEvent, SubagentSlotSnapshot, SubagentState, SubagentUsage } from '@chaptale/shared';

/** 执行器返回的最小结果约定：状态映射终态，usage 与落盘引用透传给事件。 */
export type SubagentOutcome = {
  status: 'success' | 'failed' | 'cancelled';
  usage?: SubagentUsage;
  runId?: string;
  outputRef?: string;
};

export type SubagentExecutor<T extends SubagentOutcome> = (signal: AbortSignal) => Promise<T>;

export type SubagentRunRequest<T extends SubagentOutcome> = {
  /** 调用方预生成的请求标识：取消与事件的路由键（同 TaskService 模式）。 */
  requestId: string;
  personaId: string;
  /** 发起委派的宿主会话；随事件透传供 UI 按会话过滤。 */
  sessionId?: string;
  execute: SubagentExecutor<T>;
};

/**
 * run 的返回值：executor 正常结束时携带其结果；
 * timeout 与"排队中/运行中被取消"由池侧直接终结，没有 outcome。
 */
export type SubagentRunResult<T extends SubagentOutcome> = {
  state: SubagentState;
  outcome?: T;
  error?: string;
};

export type SubagentPoolOptions = {
  /** 并发上限；超限任务 FIFO 排队。 */
  maxConcurrency?: number;
  /** 单任务超时；到点后 abort 并立即判 timeout，不等 executor 返回。 */
  timeoutMs?: number;
};

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

type Entry<T extends SubagentOutcome> = {
  requestId: string;
  personaId: string;
  sessionId?: string;
  execute: SubagentExecutor<T>;
  controller: AbortController;
  resolve: (result: SubagentRunResult<T>) => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
};

/**
 * 子任务槽位池：并发上限 + FIFO 排队 + 超时/取消兜底 + 状态机事件。
 *
 * 池对执行内容零感知（pi-free）：executor 以 AbortSignal 为唯一契约。
 * 取消与超时都由池侧立即终结并释放槽位——executor 无视 signal 也不会
 * 产生僵尸占位，其后台工作由 signal 传导到底层会话自行中止。
 */
export class SubagentPool {
  private readonly maxConcurrency: number;
  private readonly timeoutMs: number;
  private readonly pending: Entry<SubagentOutcome>[] = [];
  private readonly running = new Map<string, Entry<SubagentOutcome>>();
  private readonly queued = new Map<string, Entry<SubagentOutcome>>();
  private readonly listeners = new Set<(event: SubagentSlotEvent) => void>();

  constructor(options: SubagentPoolOptions = {}) {
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 订阅槽位状态机事件；返回退订函数。 */
  onEvent(listener: (event: SubagentSlotEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 活跃（排队+运行中）槽位快照；供窗口重开后恢复展示。 */
  listActive(sessionId?: string): SubagentSlotSnapshot[] {
    const snapshots: SubagentSlotSnapshot[] = [];

    for (const entry of this.queued.values()) {
      snapshots.push(toSnapshot(entry, 'queued'));
    }

    for (const entry of this.running.values()) {
      snapshots.push(toSnapshot(entry, 'running'));
    }

    return sessionId ? snapshots.filter(snapshot => snapshot.sessionId === sessionId) : snapshots;
  }

  run<T extends SubagentOutcome>(request: SubagentRunRequest<T>): Promise<SubagentRunResult<T>> {
    if (this.queued.has(request.requestId) || this.running.has(request.requestId)) {
      throw new Error(`重复的子任务请求：${request.requestId}`);
    }

    return new Promise<SubagentRunResult<T>>(resolve => {
      const entry: Entry<SubagentOutcome> = {
        requestId: request.requestId,
        personaId: request.personaId,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        execute: request.execute,
        controller: new AbortController(),
        resolve: resolve as Entry<SubagentOutcome>['resolve'],
        settled: false
      };

      this.pending.push(entry);
      this.queued.set(entry.requestId, entry);
      this.emit(entry, 'queued');
      this.schedule();
    });
  }

  /** 取消单个任务：排队中直接出队；运行中 abort 并立即终结释放槽位。 */
  cancel(requestId: string): void {
    const queuedEntry = this.queued.get(requestId);

    if (queuedEntry) {
      this.pending.splice(this.pending.indexOf(queuedEntry), 1);
      this.queued.delete(requestId);
      queuedEntry.settled = true;
      this.emit(queuedEntry, 'cancelled');
      queuedEntry.resolve({ state: 'cancelled' });
      return;
    }

    const runningEntry = this.running.get(requestId);

    if (runningEntry) {
      runningEntry.controller.abort();
      this.settle(runningEntry, 'cancelled');
    }
  }

  cancelAll(): void {
    for (const requestId of [...this.queued.keys(), ...this.running.keys()]) {
      this.cancel(requestId);
    }
  }

  private schedule(): void {
    while (this.running.size < this.maxConcurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this.queued.delete(entry.requestId);
      this.start(entry);
    }
  }

  private start(entry: Entry<SubagentOutcome>): void {
    this.running.set(entry.requestId, entry);
    this.emit(entry, 'running');

    entry.timer = setTimeout(() => {
      entry.controller.abort();
      this.settle(entry, 'timeout');
    }, this.timeoutMs);

    entry.execute(entry.controller.signal).then(
      outcome => this.settle(entry, outcome.status, outcome),
      (error: unknown) =>
        this.settle(entry, 'failed', undefined, error instanceof Error ? error.message : String(error))
    );
  }

  /** 终结入口（幂等）：超时/取消先到则 executor 的晚到结果被忽略。 */
  private settle(entry: Entry<SubagentOutcome>, state: SubagentState, outcome?: SubagentOutcome, error?: string): void {
    if (entry.settled) {
      return;
    }

    entry.settled = true;
    clearTimeout(entry.timer);
    this.running.delete(entry.requestId);
    this.emit(entry, state, outcome, error);
    entry.resolve({ state, ...(outcome ? { outcome } : {}), ...(error ? { error } : {}) });
    this.schedule();
  }

  private emit(entry: Entry<SubagentOutcome>, state: SubagentState, outcome?: SubagentOutcome, error?: string): void {
    const event: SubagentSlotEvent = {
      requestId: entry.requestId,
      personaId: entry.personaId,
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      state,
      ...(outcome?.usage ? { usage: outcome.usage } : {}),
      ...(outcome?.runId ? { runId: outcome.runId } : {}),
      ...(outcome?.outputRef ? { outputRef: outcome.outputRef } : {}),
      ...(error ? { error } : {})
    };

    for (const listener of this.listeners) {
      // 单个监听器异常不得中断状态机推进与其他监听器。
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

function toSnapshot(
  entry: { requestId: string; personaId: string; sessionId?: string },
  state: SubagentState
): SubagentSlotSnapshot {
  return {
    requestId: entry.requestId,
    personaId: entry.personaId,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    state
  };
}
