import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

import type {
  ChaptaleDesktopApi,
  TaskReadRunOutputResult,
  TaskRunCompleteEvent,
  TaskRunPayload
} from '@chaptale/ipc-contract';
import type { ReviewIssues } from '@chaptale/shared';

import {
  reviewLaneTestHelpers,
  projectReviewLaneIssues,
  useReviewLanes,
  type ReviewLaneKey
} from '../composables/useReviewLanes';

type TaskApi = NonNullable<ChaptaleDesktopApi['tasks']>;
type RunTask = (payload: TaskRunPayload) => Promise<TaskRunCompleteEvent>;
type CancelTask = (requestId: string) => Promise<void>;
type ReadRunOutput = (outputRef: string) => Promise<TaskReadRunOutputResult | null>;
type TaskMocks = {
  run: Mock<RunTask>;
  cancel: Mock<CancelTask>;
  listRuns: Mock<TaskApi['listRuns']>;
  readRunOutput: Mock<ReadRunOutput>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function installDesktopMock(overrides: Partial<TaskMocks> = {}) {
  const tasks: TaskMocks = {
    run: vi.fn(async payload => successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`)),
    cancel: vi.fn(async () => undefined),
    listRuns: vi.fn(async () => ({ records: [], diagnostics: [] })),
    readRunOutput: vi.fn<ReadRunOutput>(async outputRef =>
      reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef))
    ),
    ...overrides
  };
  const desktopApi = { tasks } satisfies Partial<ChaptaleDesktopApi>;

  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    writable: true,
    value: desktopApi
  });

  return tasks;
}

function successRun(personaId: string, runId: string, outputRef: string): TaskRunCompleteEvent {
  return { status: 'success', runId, outputRef, output: { summary: `不应使用 inline ${personaId}`, issues: [] } };
}

function reviewEnvelope(runId: string, output: ReviewIssues): TaskReadRunOutputResult {
  return { kind: 'review', runId, output };
}

function outputForRef(outputRef: string): ReviewIssues {
  if (outputRef.includes('character')) {
    return characterOutput('人物结果');
  }
  if (outputRef.includes('style')) {
    return styleOutput('文风结果');
  }
  return continuityOutput('连贯结果');
}

function continuityOutput(summary = '连贯摘要'): ReviewIssues {
  return {
    summary,
    issues: [
      {
        agentType: 'continuity',
        type: 'timeline',
        severity: 'high',
        quote: '旧门',
        reason: '时间线冲突',
        suggestion: '统一事件顺序'
      }
    ]
  };
}

function characterOutput(summary = '人物摘要'): ReviewIssues {
  return {
    summary,
    issues: [
      {
        agentType: 'character',
        type: 'ooc',
        severity: 'medium',
        quote: '她突然大笑',
        reason: '行为动机不足',
        suggestion: '补足情绪铺垫',
        expectedBehavior: '保持克制'
      }
    ]
  };
}

function styleOutput(summary = '文风摘要'): ReviewIssues {
  return {
    summary,
    issues: [
      {
        agentType: 'style',
        type: 'flat_rhythm',
        severity: 'low',
        quote: '句子很平',
        reason: '节奏单一',
        suggestion: '调整长短句',
        rewriteSuggestion: '把动作拆开写'
      }
    ]
  };
}

function laneOf(model: ReturnType<typeof useReviewLanes>, laneKey: ReviewLaneKey) {
  const lane = model.lanes.find(item => item.key === laneKey);
  expect(lane).toBeDefined();
  return lane!;
}

function runPayloadAt(tasks: TaskMocks, index: number) {
  const call = tasks.run.mock.calls[index];
  expect(call).toBeDefined();
  return call![0];
}

describe('recent id helpers', () => {
  it('重复 ID 不重复入队，并始终保持 FIFO 顺序', () => {
    const store = reviewLaneTestHelpers.createRecentIdSet();

    reviewLaneTestHelpers.rememberRecentId(store, 'a');
    reviewLaneTestHelpers.rememberRecentId(store, 'b');
    reviewLaneTestHelpers.rememberRecentId(store, 'a');

    expect([...store.values]).toEqual(['a', 'b']);
    expect(store.order).toEqual(['a', 'b']);
  });

  it('超过上限时优先淘汰最旧非 retained ID，总量始终 <= 128', () => {
    const store = reviewLaneTestHelpers.createRecentIdSet();
    for (let index = 0; index < reviewLaneTestHelpers.MAX_TRACKED_REVIEW_TASK_IDS; index += 1) {
      reviewLaneTestHelpers.rememberRecentId(store, `id-${index}`);
    }

    reviewLaneTestHelpers.rememberRecentId(store, 'retained-0');
    const retainedIds = new Set(['retained-0']);
    reviewLaneTestHelpers.rememberRecentId(store, 'id-overflow', retainedIds);

    expect(store.values.size).toBeLessThanOrEqual(reviewLaneTestHelpers.MAX_TRACKED_REVIEW_TASK_IDS);
    expect(store.values.has('id-0')).toBe(false);
    expect(store.values.has('id-overflow')).toBe(true);
  });

  it('全 retained 时放弃新增，不会死循环也不会突破上限', () => {
    const store = reviewLaneTestHelpers.createRecentIdSet();
    const retainedIds = new Set<string>();

    for (let index = 0; index < reviewLaneTestHelpers.MAX_TRACKED_REVIEW_TASK_IDS; index += 1) {
      const id = `retained-${index}`;
      retainedIds.add(id);
      reviewLaneTestHelpers.rememberRecentId(store, id, retainedIds);
    }

    reviewLaneTestHelpers.rememberRecentId(store, 'overflow-blocked', retainedIds);

    expect(store.values.size).toBe(reviewLaneTestHelpers.MAX_TRACKED_REVIEW_TASK_IDS);
    expect(store.values.has('overflow-blocked')).toBe(false);
    expect(store.order).toHaveLength(reviewLaneTestHelpers.MAX_TRACKED_REVIEW_TASK_IDS);
  });
});

describe('useReviewLanes', () => {
  beforeEach(() => {
    delete window.chaptaleDesktop;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete window.chaptaleDesktop;
    vi.restoreAllMocks();
  });

  it('startAll 为三个 reviewer 并发生成不同 requestId，并只使用 readRunOutput 的结构化结果', async () => {
    const tasks = installDesktopMock();
    const model = useReviewLanes(
      () => '  旧门打开  ',
      () => ['ctx-a.md']
    );

    await model.startAll();

    expect(tasks.run).toHaveBeenCalledTimes(3);
    const payloads = tasks.run.mock.calls.map(([payload]) => payload);
    expect(new Set(payloads.map(payload => payload.requestId)).size).toBe(3);
    expect(payloads.map(payload => payload.personaId)).toEqual([
      'continuity-reviewer',
      'character-reviewer',
      'style-reviewer'
    ]);
    expect(payloads.map(payload => payload.text)).toEqual(['旧门打开', '旧门打开', '旧门打开']);
    expect(payloads.map(payload => payload.contextFilePaths)).toEqual([['ctx-a.md'], ['ctx-a.md'], ['ctx-a.md']]);
    expect(tasks.readRunOutput).toHaveBeenCalledTimes(3);
    expect(model.lanes.map(lane => lane.status)).toEqual(['done', 'done', 'done']);
    expect(laneOf(model, 'continuity').result?.summary).toBe('连贯结果');
    expect(laneOf(model, 'character').result?.summary).toBe('人物结果');
    expect(laneOf(model, 'style').result?.summary).toBe('文风结果');
  });

  it('一路 read null 时只把该路标记为 read-failed，其他路保持 done', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi.fn(async outputRef => {
        if (outputRef.includes('character')) {
          return null;
        }
        return reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef));
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.startAll();

    expect(laneOf(model, 'continuity').status).toBe('done');
    expect(laneOf(model, 'character').status).toBe('read-failed');
    expect(laneOf(model, 'style').status).toBe('done');
    expect(tasks.readRunOutput).toHaveBeenCalledTimes(3);
  });

  it('read reject、wrong runId 与 raw 失败都进入 read-failed', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi
        .fn<ReadRunOutput>()
        .mockRejectedValueOnce(new Error('磁盘读取失败'))
        .mockResolvedValueOnce(reviewEnvelope('wrong-run', characterOutput()))
        .mockResolvedValueOnce({ kind: 'raw', runId: 'run-style-reviewer', rawText: 'raw text' })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.startAll();

    expect(model.lanes.map(lane => lane.status)).toEqual(['read-failed', 'read-failed', 'read-failed']);
    expect(tasks.readRunOutput).toHaveBeenCalledTimes(3);
  });

  it('三类 reviewer 的 schema mismatch 都进入 read-failed', async () => {
    installDesktopMock({
      readRunOutput: vi.fn(async outputRef => ({
        kind: 'review',
        runId: outputRef.replace('ref-', 'run-'),
        output: { summary: '缺少 issues' }
      }))
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.startAll();

    expect(laneOf(model, 'continuity').status).toBe('read-failed');
    expect(laneOf(model, 'character').status).toBe('read-failed');
    expect(laneOf(model, 'style').status).toBe('read-failed');
  });

  it('retryRead 只重新读取当前 outputRef，不再次调用 tasks.run', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi
        .fn<ReadRunOutput>()
        .mockResolvedValueOnce(reviewEnvelope('run-continuity-reviewer', continuityOutput()))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(reviewEnvelope('run-style-reviewer', styleOutput()))
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );
    await model.startAll();

    tasks.readRunOutput.mockResolvedValueOnce(reviewEnvelope('run-character-reviewer', characterOutput('重读成功')));
    await model.retryRead('character');

    expect(tasks.run).toHaveBeenCalledTimes(3);
    expect(tasks.readRunOutput).toHaveBeenCalledTimes(4);
    expect(tasks.readRunOutput).toHaveBeenLastCalledWith('ref-character-reviewer');
    expect(laneOf(model, 'character').status).toBe('done');
    expect(laneOf(model, 'character').result?.summary).toBe('重读成功');
  });

  it('cancel 只传当前 lane 的 requestId', async () => {
    const pendingRuns = [
      deferred<TaskRunCompleteEvent>(),
      deferred<TaskRunCompleteEvent>(),
      deferred<TaskRunCompleteEvent>()
    ];
    const tasks = installDesktopMock({
      run: vi.fn(
        (_payload: TaskRunPayload) => pendingRuns[tasks.run.mock.calls.length - 1]?.promise ?? pendingRuns[0].promise
      )
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const pendingStart = model.startAll();
    expect(tasks.run).toHaveBeenCalledTimes(3);
    const characterRequestId = runPayloadAt(tasks, 1).requestId;

    await model.cancel('character');

    expect(tasks.cancel).toHaveBeenCalledTimes(1);
    expect(tasks.cancel).toHaveBeenCalledWith(characterRequestId);

    pendingRuns[0].resolve(successRun('continuity-reviewer', 'run-continuity-reviewer', 'ref-continuity-reviewer'));
    pendingRuns[1].resolve({ status: 'cancelled', runId: 'run-character-reviewer' });
    pendingRuns[2].resolve(successRun('style-reviewer', 'run-style-reviewer', 'ref-style-reviewer'));
    await pendingStart;
  });

  it('cancel 成功后立即本地 cancelled，旧 run success 不会复活 lane', async () => {
    const characterRun = deferred<TaskRunCompleteEvent>();
    const tasks = installDesktopMock({
      run: vi.fn(async payload => {
        if (payload.personaId === 'character-reviewer') {
          return characterRun.promise;
        }
        return successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`);
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const pendingStart = model.startAll();
    await Promise.resolve();
    const characterRequestId = runPayloadAt(tasks, 1).requestId;

    await model.cancel('character');

    expect(tasks.cancel).toHaveBeenCalledWith(characterRequestId);
    expect(laneOf(model, 'character').status).toBe('cancelled');
    expect(laneOf(model, 'character').errors).toEqual([]);

    characterRun.resolve(successRun('character-reviewer', 'old-character-run', 'old-character-ref'));
    await pendingStart;

    expect(laneOf(model, 'character').status).toBe('cancelled');
    expect(laneOf(model, 'character').runId).not.toBe('old-character-run');
    expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain('old-character-ref');
  });

  it('cancel reject 且 token 仍当前时变 failed 并写明确错误', async () => {
    const characterRun = deferred<TaskRunCompleteEvent>();
    const tasks = installDesktopMock({
      run: vi.fn(async payload => {
        if (payload.personaId === 'character-reviewer') {
          return characterRun.promise;
        }
        return successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`);
      }),
      cancel: vi.fn(async () => {
        throw new Error('取消 IPC 失败');
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const pendingStart = model.startAll();
    await Promise.resolve();

    await model.cancel('character');

    expect(tasks.cancel).toHaveBeenCalledTimes(1);
    expect(laneOf(model, 'character').status).toBe('failed');
    expect(laneOf(model, 'character').errors).toEqual(['取消 IPC 失败']);

    characterRun.resolve(successRun('character-reviewer', 'old-character-run', 'old-character-ref'));
    await pendingStart;
    expect(laneOf(model, 'character').status).toBe('failed');
  });

  it('晚到的旧 run 响应不会覆盖同 persona 的新 run', async () => {
    const oldRuns = [
      deferred<TaskRunCompleteEvent>(),
      deferred<TaskRunCompleteEvent>(),
      deferred<TaskRunCompleteEvent>()
    ];
    let runIndex = 0;
    const tasks = installDesktopMock({
      run: vi.fn(async payload => {
        runIndex += 1;
        if (runIndex <= 3) {
          return oldRuns[runIndex - 1].promise;
        }
        return successRun(payload.personaId, `new-${payload.personaId}`, `new-ref-${payload.personaId}`);
      }),
      readRunOutput: vi.fn(async outputRef =>
        reviewEnvelope(outputRef.replace('new-ref-', 'new-'), outputForRef(outputRef))
      )
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const oldStart = model.startAll();
    await model.startAll();

    oldRuns[0].resolve(successRun('continuity-reviewer', 'old-continuity-reviewer', 'old-ref-continuity-reviewer'));
    oldRuns[1].resolve(successRun('character-reviewer', 'old-character-reviewer', 'old-ref-character-reviewer'));
    oldRuns[2].resolve(successRun('style-reviewer', 'old-style-reviewer', 'old-ref-style-reviewer'));
    await oldStart;

    expect(model.lanes.map(lane => lane.runId)).toEqual([
      'new-continuity-reviewer',
      'new-character-reviewer',
      'new-style-reviewer'
    ]);
    expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain('old-ref-continuity-reviewer');
  });

  it('晚到的旧 read 响应不会覆盖同 persona 的新 read 结果', async () => {
    const oldRead = deferred<TaskReadRunOutputResult | null>();
    let runIndex = 0;
    installDesktopMock({
      run: vi.fn(async payload => {
        runIndex += 1;
        const phase = runIndex <= 3 ? 'old' : 'new';
        return successRun(payload.personaId, `${phase}-${payload.personaId}`, `${phase}-ref-${payload.personaId}`);
      }),
      readRunOutput: vi.fn(async outputRef => {
        if (outputRef === 'old-ref-continuity-reviewer') {
          return oldRead.promise;
        }
        return reviewEnvelope(outputRef.replace('-ref-', '-'), outputForRef(outputRef));
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const oldStart = model.startAll();
    await Promise.resolve();
    await model.startAll();
    oldRead.resolve(reviewEnvelope('old-continuity-reviewer', continuityOutput('旧结果')));
    await oldStart;

    expect(laneOf(model, 'continuity').runId).toBe('new-continuity-reviewer');
    expect(laneOf(model, 'continuity').result?.summary).not.toBe('旧结果');
  });

  it('attachSubagentTasks 只接纳三类 reviewer 的终态事件，并按 runId 去重', async () => {
    const read = deferred<TaskReadRunOutputResult | null>();
    const tasks = installDesktopMock({
      readRunOutput: vi.fn(async () => read.promise)
    });
    const model = useReviewLanes(
      () => '正文不用于 delegate',
      () => []
    );

    const pendingAttach = model.attachSubagentTasks([
      { requestId: 'req-c', personaId: 'continuity-reviewer', state: 'success', runId: 'run-c', outputRef: 'ref-c' },
      {
        requestId: 'req-c-dup',
        personaId: 'continuity-reviewer',
        state: 'success',
        runId: 'run-c',
        outputRef: 'ref-c-dup'
      },
      {
        requestId: 'req-other',
        personaId: 'other-reviewer',
        state: 'success',
        runId: 'run-other',
        outputRef: 'ref-other'
      },
      {
        requestId: 'req-queued',
        personaId: 'style-reviewer',
        state: 'running',
        runId: 'run-running',
        outputRef: 'ref-running'
      },
      { requestId: 'req-s', personaId: 'style-reviewer', state: 'timeout', runId: 'run-s', error: '超时' },
      { requestId: 'req-ch', personaId: 'character-reviewer', state: 'cancelled', runId: 'run-ch' }
    ]);

    expect(laneOf(model, 'continuity').status).toBe('reading');
    expect(laneOf(model, 'continuity').submittedText).toBeUndefined();
    expect(laneOf(model, 'style').status).toBe('failed');
    expect(laneOf(model, 'character').status).toBe('cancelled');
    expect(tasks.readRunOutput).toHaveBeenCalledTimes(1);
    expect(tasks.readRunOutput).toHaveBeenCalledWith('ref-c');

    read.resolve(reviewEnvelope('run-c', continuityOutput('delegate 结果')));
    await pendingAttach;

    expect(laneOf(model, 'continuity').status).toBe('done');
    expect(laneOf(model, 'continuity').result?.summary).toBe('delegate 结果');
  });

  it('attach malformed success 不污染去重，后续同 runId 合法 success 仍可接纳', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi.fn(async () => reviewEnvelope('run-c', continuityOutput('合法结果')))
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.attachSubagentTasks({
      requestId: 'req-bad',
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'run-c'
    });

    expect(laneOf(model, 'continuity').status).toBe('idle');
    expect(tasks.readRunOutput).not.toHaveBeenCalled();

    await model.attachSubagentTasks({
      requestId: 'req-good',
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'run-c',
      outputRef: 'ref-c'
    });

    expect(tasks.readRunOutput).toHaveBeenCalledTimes(1);
    expect(laneOf(model, 'continuity').status).toBe('done');
    expect(laneOf(model, 'continuity').result?.summary).toBe('合法结果');
  });

  it('attach 无 runId terminal 全部忽略', async () => {
    const tasks = installDesktopMock();
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.attachSubagentTasks([
      { requestId: 'req-success', personaId: 'continuity-reviewer', state: 'success', outputRef: 'ref-c' },
      { requestId: 'req-failed', personaId: 'character-reviewer', state: 'failed', error: '失败' },
      { requestId: 'req-cancelled', personaId: 'style-reviewer', state: 'cancelled' }
    ]);

    expect(model.lanes.map(lane => lane.status)).toEqual(['idle', 'idle', 'idle']);
    expect(tasks.readRunOutput).not.toHaveBeenCalled();
  });

  it('当前 lane running 时 mismatch attach 旧事件不得接管', async () => {
    const continuityRun = deferred<TaskRunCompleteEvent>();
    const tasks = installDesktopMock({
      run: vi.fn(async payload => {
        if (payload.personaId === 'continuity-reviewer') {
          return continuityRun.promise;
        }
        return successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`);
      }),
      readRunOutput: vi.fn(async outputRef =>
        reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef))
      )
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const pendingStart = model.startAll();
    await Promise.resolve();
    const activeRequestId = laneOf(model, 'continuity').requestId;

    await model.attachSubagentTasks({
      requestId: 'old-req',
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'old-run',
      outputRef: 'old-ref'
    });

    expect(laneOf(model, 'continuity').status).toBe('running');
    expect(laneOf(model, 'continuity').requestId).toBe(activeRequestId);
    expect(laneOf(model, 'continuity').runId).toBeNull();
    expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain('old-ref');

    continuityRun.resolve(successRun('continuity-reviewer', 'run-continuity-reviewer', 'ref-continuity-reviewer'));
    await pendingStart;
  });

  it('新 direct start 已 done 后 mismatch 旧 attach terminal 不得覆盖当前结果', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi.fn(async outputRef => {
        if (outputRef === 'old-ref') {
          return reviewEnvelope('old-run', continuityOutput('旧 attach 结果'));
        }
        return reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef));
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.startAll();
    const currentRunId = laneOf(model, 'continuity').runId;
    const currentSummary = laneOf(model, 'continuity').result?.summary;

    await model.attachSubagentTasks({
      requestId: 'old-req',
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'old-run',
      outputRef: 'old-ref'
    });

    expect(laneOf(model, 'continuity').status).toBe('done');
    expect(laneOf(model, 'continuity').runId).toBe(currentRunId);
    expect(laneOf(model, 'continuity').result?.summary).toBe(currentSummary);
    expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain('old-ref');
  });

  it('非 idle 终态 lane 的 mismatch attach terminal 不得无条件覆盖', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi.fn(async outputRef => {
        if (outputRef === 'read-failed-ref') {
          return null;
        }
        return reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef));
      })
    });

    for (const state of ['read-failed', 'failed', 'cancelled'] as const) {
      const model = useReviewLanes(
        () => '正文',
        () => []
      );
      if (state === 'read-failed') {
        await model.attachSubagentTasks({
          requestId: 'current-read-failed-req',
          personaId: 'continuity-reviewer',
          state: 'success',
          runId: 'current-read-failed-run',
          outputRef: 'read-failed-ref'
        });
      } else {
        await model.attachSubagentTasks({
          requestId: `current-${state}-req`,
          personaId: 'continuity-reviewer',
          state,
          runId: `current-${state}-run`,
          error: '当前终态'
        });
      }

      const currentRequestId = laneOf(model, 'continuity').requestId;
      const currentRunId = laneOf(model, 'continuity').runId;
      const currentStatus = laneOf(model, 'continuity').status;

      await model.attachSubagentTasks({
        requestId: `old-${state}-req`,
        personaId: 'continuity-reviewer',
        state: 'success',
        runId: `old-${state}-run`,
        outputRef: `old-${state}-ref`
      });

      expect(laneOf(model, 'continuity').status).toBe(currentStatus);
      expect(laneOf(model, 'continuity').requestId).toBe(currentRequestId);
      expect(laneOf(model, 'continuity').runId).toBe(currentRunId);
      expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain(`old-${state}-ref`);
    }
  });

  it('dismiss 后同 requestId 的旧 attach terminal 不得复活 lane', async () => {
    const continuityRun = deferred<TaskRunCompleteEvent>();
    const tasks = installDesktopMock({
      run: vi.fn(async payload => {
        if (payload.personaId === 'continuity-reviewer') {
          return continuityRun.promise;
        }
        return successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`);
      })
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    const pendingStart = model.startAll();
    await Promise.resolve();
    const dismissedRequestId = laneOf(model, 'continuity').requestId!;

    model.dismiss('continuity');
    await model.attachSubagentTasks({
      requestId: dismissedRequestId,
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'dismissed-run',
      outputRef: 'dismissed-ref'
    });

    expect(laneOf(model, 'continuity').status).toBe('idle');
    expect(tasks.readRunOutput.mock.calls.map(([outputRef]) => outputRef)).not.toContain('dismissed-ref');

    continuityRun.resolve(successRun('continuity-reviewer', 'run-continuity-reviewer', 'ref-continuity-reviewer'));
    await pendingStart;
  });

  it('retryRead pending 时 mismatch attach 不得覆盖当前 reading lane', async () => {
    const retryRead = deferred<TaskReadRunOutputResult | null>();
    const tasks = installDesktopMock();
    const model = useReviewLanes(
      () => '正文',
      () => []
    );
    await model.startAll();

    tasks.readRunOutput.mockImplementation(async outputRef => {
      if (outputRef === 'ref-continuity-reviewer') {
        return retryRead.promise;
      }
      if (outputRef === 'external-ref') {
        return reviewEnvelope('external-run', continuityOutput('外部旧结果'));
      }
      return reviewEnvelope(outputRef.replace('ref-', 'run-'), outputForRef(outputRef));
    });

    const pendingRetry = model.retryRead('continuity');
    await Promise.resolve();
    expect(laneOf(model, 'continuity').status).toBe('reading');

    await model.attachSubagentTasks({
      requestId: 'external-req',
      personaId: 'continuity-reviewer',
      state: 'success',
      runId: 'external-run',
      outputRef: 'external-ref'
    });

    expect(laneOf(model, 'continuity').status).toBe('reading');
    expect(laneOf(model, 'continuity').runId).toBe('run-continuity-reviewer');
    expect(laneOf(model, 'continuity').outputRef).toBe('ref-continuity-reviewer');

    retryRead.resolve(reviewEnvelope('run-continuity-reviewer', continuityOutput('重试结果')));
    await pendingRetry;
    expect(laneOf(model, 'continuity').result?.summary).toBe('重试结果');
  });

  it('retryRead pending 后新 start 的结果不被旧 retry read 覆盖', async () => {
    const retryRead = deferred<TaskReadRunOutputResult | null>();
    const tasks = installDesktopMock();
    const model = useReviewLanes(
      () => '正文',
      () => []
    );
    await model.startAll();

    tasks.run.mockResolvedValueOnce(
      successRun('continuity-reviewer', 'new-continuity-reviewer', 'new-ref-continuity-reviewer')
    );
    tasks.run.mockResolvedValueOnce(
      successRun('character-reviewer', 'new-character-reviewer', 'new-ref-character-reviewer')
    );
    tasks.run.mockResolvedValueOnce(successRun('style-reviewer', 'new-style-reviewer', 'new-ref-style-reviewer'));
    tasks.readRunOutput.mockImplementation(async outputRef => {
      if (outputRef === 'ref-continuity-reviewer') {
        return retryRead.promise;
      }
      return reviewEnvelope(outputRef.replace('new-ref-', 'new-'), outputForRef(outputRef));
    });

    const pendingRetry = model.retryRead('continuity');
    await Promise.resolve();
    await model.startAll();

    retryRead.resolve(reviewEnvelope('run-continuity-reviewer', continuityOutput('旧 retry 结果')));
    await pendingRetry;

    expect(laneOf(model, 'continuity').runId).toBe('new-continuity-reviewer');
    expect(laneOf(model, 'continuity').result?.summary).not.toBe('旧 retry 结果');
  });

  it('attach success 的 read reject、null、wrong run 仍进入 read-failed', async () => {
    const tasks = installDesktopMock({
      readRunOutput: vi
        .fn<ReadRunOutput>()
        .mockRejectedValueOnce(new Error('读取失败'))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(reviewEnvelope('wrong-run', styleOutput()))
    });
    const model = useReviewLanes(
      () => '正文',
      () => []
    );

    await model.attachSubagentTasks([
      { requestId: 'req-c', personaId: 'continuity-reviewer', state: 'success', runId: 'run-c', outputRef: 'ref-c' },
      { requestId: 'req-ch', personaId: 'character-reviewer', state: 'success', runId: 'run-ch', outputRef: 'ref-ch' },
      { requestId: 'req-s', personaId: 'style-reviewer', state: 'success', runId: 'run-s', outputRef: 'ref-s' }
    ]);

    expect(tasks.readRunOutput).toHaveBeenCalledTimes(3);
    expect(laneOf(model, 'continuity').status).toBe('read-failed');
    expect(laneOf(model, 'character').status).toBe('read-failed');
    expect(laneOf(model, 'style').status).toBe('read-failed');
  });

  it('没有 desktop bridge 时保持三路 idle，所有动作都是 no-op', async () => {
    const model = useReviewLanes(
      () => '正文',
      () => ['ctx.md']
    );

    await expect(model.startAll()).resolves.toBeUndefined();
    await expect(model.retryRead('continuity')).resolves.toBeUndefined();
    await expect(model.cancel('style')).resolves.toBeUndefined();
    await expect(
      model.attachSubagentTasks({
        requestId: 'req-c',
        personaId: 'continuity-reviewer',
        state: 'success',
        runId: 'run-c',
        outputRef: 'ref-c'
      })
    ).resolves.toBeUndefined();
    model.dismiss('character');

    expect(model.lanes.map(lane => lane.status)).toEqual(['idle', 'idle', 'idle']);
  });

  it('projectReviewLaneIssues 只在 direct 文本非空时派生 anchor', async () => {
    const tasks = installDesktopMock({
      run: vi.fn(async payload =>
        successRun(payload.personaId, `run-${payload.personaId}`, `ref-${payload.personaId}`)
      ),
      readRunOutput: vi.fn(async outputRef =>
        reviewEnvelope(outputRef.replace('ref-', 'run-'), continuityOutput('有 anchor'))
      )
    });
    const directModel = useReviewLanes(
      () => '这里有旧门',
      () => []
    );
    await directModel.startAll();

    const anchored = projectReviewLaneIssues(laneOf(directModel, 'continuity'));
    expect(anchored[0]?.anchor).toEqual({ stale: false, start: 3, end: 5, strategy: 'exact' });

    tasks.readRunOutput.mockResolvedValue(reviewEnvelope('run-continuity-reviewer', continuityOutput('无 anchor')));
    const attachmentOnlyModel = useReviewLanes(
      () => '   ',
      () => ['ctx.md']
    );
    await attachmentOnlyModel.startAll();

    const attachmentOnly = projectReviewLaneIssues(laneOf(attachmentOnlyModel, 'continuity'));
    expect(attachmentOnly[0]?.anchor).toBeUndefined();
  });
});
