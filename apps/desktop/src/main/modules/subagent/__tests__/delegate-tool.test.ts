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
    const tool = await createDelegateTool(context);

    const result = await tool.execute({ to: 'continuity-reviewer', brief: '审查衔接', text: '正文' });

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
    expect(result.details).toMatchObject({ personaId: 'continuity-reviewer', state: 'success', runId: 'run-1' });
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
    expect(result.details).toMatchObject({ state: 'failed', runId: 'run-2' });
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
    expect(result.details).toMatchObject({ state: 'cancelled' });
  });
});
