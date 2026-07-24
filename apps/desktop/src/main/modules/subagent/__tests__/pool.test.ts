import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubagentSlotEvent } from '@chaptale/shared';

import { SubagentPool, type SubagentOutcome } from '../pool';

/** 手动控制完成时机的执行器：返回 { promise, resolve, signals } 供测试驱动。 */
function deferredExecutor(outcome: SubagentOutcome = { status: 'success' }) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const signals: AbortSignal[] = [];
  const execute = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    await gate;
    return outcome;
  });

  return { execute, release, signals };
}

function collectEvents(pool: SubagentPool): SubagentSlotEvent[] {
  const events: SubagentSlotEvent[] = [];
  pool.onEvent(event => events.push(event));
  return events;
}

describe('SubagentPool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('caps concurrency and starts queued entries in FIFO order', async () => {
    const pool = new SubagentPool({ maxConcurrency: 2 });
    const a = deferredExecutor();
    const b = deferredExecutor();
    const c = deferredExecutor();

    const runA = pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });
    void pool.run({ requestId: 'b', personaId: 'p', execute: b.execute });
    void pool.run({ requestId: 'c', personaId: 'p', execute: c.execute });

    expect(a.execute).toHaveBeenCalled();
    expect(b.execute).toHaveBeenCalled();
    expect(c.execute).not.toHaveBeenCalled();

    a.release();
    await expect(runA).resolves.toMatchObject({ state: 'success' });
    expect(c.execute).toHaveBeenCalled();
  });

  it('cancels a queued entry without ever executing it', async () => {
    const pool = new SubagentPool({ maxConcurrency: 1 });
    const a = deferredExecutor();
    const b = deferredExecutor();

    void pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });
    const runB = pool.run({ requestId: 'b', personaId: 'p', execute: b.execute });

    pool.cancel('b');
    await expect(runB).resolves.toEqual({ state: 'cancelled' });
    expect(b.execute).not.toHaveBeenCalled();
  });

  it('cancelling a running entry aborts its signal and frees the slot immediately', async () => {
    const pool = new SubagentPool({ maxConcurrency: 1 });
    const a = deferredExecutor();
    const b = deferredExecutor();

    const runA = pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });
    void pool.run({ requestId: 'b', personaId: 'p', execute: b.execute });

    pool.cancel('a');
    await expect(runA).resolves.toMatchObject({ state: 'cancelled' });
    expect(a.signals[0]?.aborted).toBe(true);
    // 槽位立即释放：排队任务无需等待被取消的 executor 真正返回。
    expect(b.execute).toHaveBeenCalled();
  });

  it('cancelAll settles queued and running entries', async () => {
    const pool = new SubagentPool({ maxConcurrency: 1 });
    const a = deferredExecutor();
    const b = deferredExecutor();

    const runA = pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });
    const runB = pool.run({ requestId: 'b', personaId: 'p', execute: b.execute });

    pool.cancelAll();
    await expect(runA).resolves.toMatchObject({ state: 'cancelled' });
    await expect(runB).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('times out a hung executor that ignores its signal, leaving no zombie slot', async () => {
    const pool = new SubagentPool({ maxConcurrency: 1, timeoutMs: 1000 });
    const hung = deferredExecutor();
    const next = deferredExecutor();

    const runHung = pool.run({ requestId: 'hung', personaId: 'p', execute: hung.execute });
    void pool.run({ requestId: 'next', personaId: 'p', execute: next.execute });

    vi.advanceTimersByTime(1000);
    await expect(runHung).resolves.toMatchObject({ state: 'timeout' });
    expect(hung.signals[0]?.aborted).toBe(true);
    expect(next.execute).toHaveBeenCalled();
  });

  it('ignores a late executor result after timeout has settled the entry', async () => {
    const pool = new SubagentPool({ timeoutMs: 1000 });
    const events = collectEvents(pool);
    const slow = deferredExecutor({ status: 'success' });

    const run = pool.run({ requestId: 'slow', personaId: 'p', execute: slow.execute });
    vi.advanceTimersByTime(1000);
    await expect(run).resolves.toMatchObject({ state: 'timeout' });

    slow.release();
    await vi.runAllTimersAsync();
    // 终态唯一：晚到的 success 不产生第二个终态事件。
    expect(
      events.filter(event => event.requestId === 'slow' && event.state !== 'queued' && event.state !== 'running')
    ).toHaveLength(1);
  });

  it('maps executor rejection to failed with the error message', async () => {
    const pool = new SubagentPool();
    const run = pool.run({
      requestId: 'boom',
      personaId: 'p',
      execute: async () => {
        throw new Error('炸了');
      }
    });

    await expect(run).resolves.toMatchObject({ state: 'failed', error: '炸了' });
  });

  it('rejects duplicate active requestIds', () => {
    const pool = new SubagentPool({ maxConcurrency: 1 });
    const a = deferredExecutor();
    void pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });

    expect(() => pool.run({ requestId: 'a', personaId: 'p', execute: a.execute })).toThrow('重复的子任务请求');
  });

  it('emits queued → running → success with usage passthrough', async () => {
    const pool = new SubagentPool();
    const events = collectEvents(pool);
    const usage = { inputTokens: 10, outputTokens: 5 };
    const a = deferredExecutor({ status: 'success', usage, runId: 'run-1', outputRef: 'runs/outputs/run-1.json' });

    const run = pool.run({ requestId: 'a', personaId: 'reviewer', execute: a.execute });
    a.release();
    await run;

    expect(events.map(event => event.state)).toEqual(['queued', 'running', 'success']);
    // 终态事件携带落盘引用，供 UI 直读结果（双通道之一）。
    expect(events[2]).toMatchObject({
      personaId: 'reviewer',
      usage,
      runId: 'run-1',
      outputRef: 'runs/outputs/run-1.json'
    });
  });

  it('keeps the state machine running when a listener throws', async () => {
    const pool = new SubagentPool();
    pool.onEvent(() => {
      throw new Error('监听器坏了');
    });
    const a = deferredExecutor();

    const run = pool.run({ requestId: 'a', personaId: 'p', execute: a.execute });
    a.release();
    await expect(run).resolves.toMatchObject({ state: 'success' });
  });
});
