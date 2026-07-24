import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import type { TaskRunResult } from '../../../integrations/pi/agent/task-runner';
import { createDelegateTool, type DelegateToolContext } from '../delegate-tool';
import { SubagentPool } from '../pool';

function persona(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'continuity-reviewer',
    name: '连续性审查',
    type: 'review',
    execution: 'task',
    output: 'continuity-review',
    body: '审查规则',
    source: 'builtin',
    ...overrides
  } as PersonaDefinition;
}

function createContext(overrides: Partial<DelegateToolContext> = {}, personas: PersonaDefinition[] = [persona()]) {
  const runResult: TaskRunResult = {
    status: 'success',
    runId: 'run-1',
    output: { summary: '发现 2 处矛盾' },
    outputRef: 'runs/outputs/run-1.txt',
    usage: { inputTokens: 100, outputTokens: 50 }
  };
  const taskRunner = { run: vi.fn(async () => runResult) };
  const context: DelegateToolContext = {
    pool: new SubagentPool(),
    taskRunner,
    personaRegistry: { load: vi.fn(async () => ({ personas, diagnostics: [] })) } as never,
    resolveCwd: async () => '/workspace',
    sessionId: 'chat-1',
    ...overrides
  };

  return { context, taskRunner };
}

describe('createDelegateTool', () => {
  it('enumerates delegatable task personas in the description snapshot', async () => {
    const personas = [
      persona(),
      persona({ id: 'style-checker', name: '风格检查', enabled: false }),
      persona({ id: 'companion', name: '陪伴', execution: 'chat', output: undefined })
    ];
    const { context } = createContext({}, personas);
    const tool = await createDelegateTool(context);

    expect(tool.name).toBe('delegate');
    expect(tool.riskLevel).toBe('readonly');
    expect(tool.description).toContain('continuity-reviewer');
    // 禁用与 chat 型不进入可委派枚举。
    expect(tool.description).not.toContain('style-checker');
    expect(tool.description).not.toContain('companion');
  });

  it('runs the task through the pool and returns summary with outputRef only', async () => {
    const { context, taskRunner } = createContext();
    const poolRun = vi.spyOn(context.pool, 'run');
    const tool = await createDelegateTool(context);

    const result = await tool.execute({
      to: 'continuity-reviewer',
      brief: '审查衔接',
      text: '正文',
      timeoutSeconds: 600
    });

    // 主 agent 设定的超时透传到池（秒→毫秒）。
    expect(poolRun).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 600_000 }));
    expect(taskRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: '审查衔接',
        text: '正文',
        trigger: 'delegate',
        parentSessionId: 'chat-1'
      })
    );
    expect(result.text).toContain('run-1');
    expect(result.text).toContain('runs/outputs/run-1.txt');
    expect(result.text).toContain('发现 2 处矛盾');
    // 红线：结构化结果全文不回传给 parent。
    expect(result.text).not.toContain('"summary"');
    expect(result.details).toMatchObject({
      tasks: [{ personaId: 'continuity-reviewer', state: 'success', runId: 'run-1' }]
    });
  });

  it('returns the available list when the target persona is not delegatable', async () => {
    const { context, taskRunner } = createContext();
    const tool = await createDelegateTool(context);

    const result = await tool.execute({ to: 'missing', brief: '审查' });

    expect(result.text).toContain('persona 不可用：missing');
    expect(result.text).toContain('continuity-reviewer');
    expect(taskRunner.run).not.toHaveBeenCalled();
  });

  it('renders validation errors for failed runs', async () => {
    const failed: TaskRunResult = {
      status: 'failed',
      runId: 'run-2',
      errors: ['缺少 issues 字段'],
      outputRef: 'runs/outputs/run-2.txt',
      usage: { inputTokens: 10, outputTokens: 5 }
    };
    const { context } = createContext({ taskRunner: { run: vi.fn(async () => failed) } });
    const tool = await createDelegateTool(context);

    const result = await tool.execute({ to: 'continuity-reviewer', brief: '审查' });

    expect(result.text).toContain('未通过校验');
    expect(result.text).toContain('缺少 issues 字段');
    expect(result.details).toMatchObject({ tasks: [{ state: 'failed', runId: 'run-2' }] });
  });

  it('cancels the pooled task when the outer tool signal aborts', async () => {
    let release!: (result: TaskRunResult) => void;
    const hanging = new Promise<TaskRunResult>(resolve => (release = resolve));
    const run = vi.fn((request: { signal?: AbortSignal }) => {
      // 池侧取消应传导到 taskRunner 的 signal。
      request.signal?.addEventListener('abort', () => release({ status: 'cancelled', runId: 'run-3' }));
      return hanging;
    });
    const { context } = createContext({ taskRunner: { run } as never });
    const tool = await createDelegateTool(context);

    const controller = new AbortController();
    const pending = tool.execute({ to: 'continuity-reviewer', brief: '审查' }, controller.signal);
    // 等待任务进入池并启动。
    await vi.waitFor(() => expect(run).toHaveBeenCalled());

    controller.abort();
    const result = await pending;

    expect(result.text).toContain('已被取消');
    expect(result.details).toMatchObject({ tasks: [{ state: 'cancelled' }] });
  });

  it('fans out array targets, waits for all lanes and reports per-lane status only', async () => {
    const runResults = new Map<string, TaskRunResult>([
      [
        'reviewer-a',
        {
          status: 'success',
          runId: 'run-a',
          output: { summary: 'A 意见' },
          outputRef: 'runs/outputs/run-a.json',
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      ],
      [
        'reviewer-b',
        {
          status: 'failed',
          runId: 'run-b',
          errors: ['缺字段'],
          outputRef: 'runs/outputs/run-b.json',
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      ],
      [
        'reviewer-c',
        {
          status: 'success',
          runId: 'run-c',
          output: { summary: 'C 意见' },
          outputRef: 'runs/outputs/run-c.json',
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      ]
    ]);
    const personas = [
      persona({ id: 'reviewer-a', name: 'A' }),
      persona({ id: 'reviewer-b', name: 'B' }),
      persona({ id: 'reviewer-c', name: 'C' })
    ];
    const run = vi.fn(async (request: { persona: PersonaDefinition }) => runResults.get(request.persona.id)!);
    const { context } = createContext({ taskRunner: { run } as never }, personas);
    const tool = await createDelegateTool(context);

    const result = await tool.execute({ to: ['reviewer-a', 'reviewer-b', 'reviewer-c'], brief: '三路并审' });

    // 屏障：三路全部终态后才返回；单路失败（reviewer-b）不连带其余路。
    expect(run).toHaveBeenCalledTimes(3);
    expect(result.text).toContain('3 路并行');
    expect(result.text).toContain('run-a');
    expect(result.text).toContain('run-b');
    expect(result.text).toContain('run-c');
    // 多路只回状态与引用，不带摘要——parent 不得聚合复述各路结果。
    expect(result.text).not.toContain('A 意见');
    expect(result.text).not.toContain('C 意见');
    expect((result.details as { tasks: unknown[] }).tasks).toHaveLength(3);
  });

  it('deduplicates repeated targets and rejects the whole call when any target is invalid', async () => {
    const { context, taskRunner } = createContext();
    const tool = await createDelegateTool(context);

    const dupResult = await tool.execute({ to: ['continuity-reviewer', 'continuity-reviewer'], brief: '审查' });
    expect(taskRunner.run).toHaveBeenCalledTimes(1);
    expect((dupResult.details as { tasks: unknown[] }).tasks).toHaveLength(1);

    taskRunner.run.mockClear();
    const invalidResult = await tool.execute({ to: ['continuity-reviewer', 'missing'], brief: '审查' });
    expect(invalidResult.text).toContain('persona 不可用：missing');
    // 整体拒绝：有效目标也不执行，避免部分执行歧义。
    expect(taskRunner.run).not.toHaveBeenCalled();
  });

  it('cancels all lanes when the outer tool signal aborts during gather', async () => {
    const releases: Array<(result: TaskRunResult) => void> = [];
    const run = vi.fn((request: { signal?: AbortSignal }) => {
      return new Promise<TaskRunResult>(resolve => {
        releases.push(resolve);
        request.signal?.addEventListener('abort', () =>
          resolve({ status: 'cancelled', runId: `run-${releases.length}` })
        );
      });
    });
    const personas = [persona({ id: 'reviewer-a', name: 'A' }), persona({ id: 'reviewer-b', name: 'B' })];
    const { context } = createContext({ taskRunner: { run } as never }, personas);
    const tool = await createDelegateTool(context);

    const controller = new AbortController();
    const pending = tool.execute({ to: ['reviewer-a', 'reviewer-b'], brief: '审查' }, controller.signal);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    controller.abort();
    const result = await pending;

    const states = (result.details as { tasks: Array<{ state: string }> }).tasks.map(lane => lane.state);
    expect(states).toEqual(['cancelled', 'cancelled']);
  });
});
