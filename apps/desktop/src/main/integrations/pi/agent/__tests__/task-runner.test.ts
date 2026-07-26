import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { estimateTextTokens } from '../../../../core/context/token-counter';
import { AgentRunStore } from '../../../../features/runs/store';
import { createDefaultToolCatalog } from '../../../../features/tools/catalog';
import { renderTaskPrompt, renderTaskPromptWithinBudget, TaskRunner } from '../task-runner';

const persona: PersonaDefinition = {
  id: 'continuity-reviewer',
  name: '连贯性审查',
  type: 'review',
  execution: 'task',
  output: 'continuity-issues',
  body: '你是连贯性审查专员。',
  source: 'builtin'
};

const validOutput = JSON.stringify({
  issues: [{ id: 'i1', severity: 'high', location: '第 3 章', description: '时间线冲突' }],
  summary: '发现 1 个高危问题'
});

function createSession(responses: string[]) {
  let index = -1;
  const session = {
    prompt: vi.fn(async () => {
      index += 1;
    }),
    getLastAssistantText: vi.fn(() => responses[Math.min(index, responses.length - 1)]),
    getSessionStats: vi.fn(() => ({ tokens: { input: 100, output: 50 } })),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn()
  };
  return session;
}

describe('TaskRunner', () => {
  let cwd: string;
  let runStore: AgentRunStore;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'chaptale-task-runner-'));
    runStore = new AgentRunStore({ resolveCwd: () => cwd });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function createRunner(session: ReturnType<typeof createSession>) {
    const factory = { createTaskSession: vi.fn(async () => session as any) };
    return { runner: new TaskRunner(factory, runStore, createDefaultToolCatalog()), factory };
  }

  it('succeeds on a valid structured output and records the run', async () => {
    const session = createSession([`分析完成。\n<output>${validOutput}</output>`]);
    const { runner } = createRunner(session);

    const result = await runner.run({ persona, cwd, brief: '审查连贯性', text: '第一章……', trigger: 'ui-action' });

    expect(result.status).toBe('success');
    expect(session.prompt).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();

    const { records } = await runStore.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      personaId: 'continuity-reviewer',
      execution: 'task',
      trigger: 'ui-action',
      status: 'success',
      usage: { inputTokens: 100, outputTokens: 50 }
    });
    expect(records[0]!.promptTemplateHash).toMatch(/^[0-9a-f]{40}$/);

    const saved = JSON.parse(await readFile(path.join(cwd, records[0]!.outputRef!), 'utf8'));
    expect(saved.rawText).toContain('<output>');
  });

  it('binds task session, output and run record to the request cwd', async () => {
    const boundCwd = path.join(cwd, 'bound-workspace');
    const session = createSession([`<output>${validOutput}</output>`]);
    const { runner, factory } = createRunner(session);

    const result = await runner.run({
      persona,
      cwd: boundCwd,
      brief: '审查',
      text: '正文',
      trigger: 'ui-action'
    });

    expect(factory.createTaskSession).toHaveBeenCalledWith(expect.any(Object), boundCwd);
    if (result.status !== 'success') throw new Error('unreachable');
    await expect(readFile(path.join(boundCwd, result.outputRef), 'utf8')).resolves.toContain('<output>');
    const runFile = path.join(
      boundCwd,
      '.chaptale',
      'runs',
      `agent-runs-${new Date().toISOString().slice(0, 7)}.jsonl`
    );
    await expect(readFile(runFile, 'utf8')).resolves.toContain(result.runId);
  });

  it('repairs invalid output through a retry prompt carrying validation errors', async () => {
    const session = createSession(['<output>{"issues": "not-an-array"}</output>', `<output>${validOutput}</output>`]);
    const { runner } = createRunner(session);

    const result = await runner.run({ persona, cwd, brief: '审查', text: '正文', trigger: 'ui-action' });

    expect(result.status).toBe('success');
    expect(session.prompt).toHaveBeenCalledTimes(2);
    const repairPrompt = (session.prompt.mock.calls as string[][])[1]![0]!;
    expect(repairPrompt).toContain('未通过校验');
    expect(repairPrompt).toContain('/issues');
  });

  it('marks the run failed after exhausting repair attempts, preserving raw output', async () => {
    const session = createSession(['没有输出标签的回答']);
    const { runner } = createRunner(session);

    const result = await runner.run({ persona, cwd, brief: '审查', text: '正文', trigger: 'ui-action' });

    expect(result.status).toBe('failed');
    expect(session.prompt).toHaveBeenCalledTimes(3);

    if (result.status !== 'failed') throw new Error('unreachable');
    const saved = JSON.parse(await readFile(path.join(cwd, result.outputRef), 'utf8'));
    expect(saved.rawText).toBe('没有输出标签的回答');

    const { records } = await runStore.list();
    expect(records[0]!.status).toBe('failed');
  });

  it('returns cancelled when the signal aborts before prompting', async () => {
    const session = createSession(['<output>{}</output>']);
    const { runner } = createRunner(session);
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run({
      persona,
      cwd,
      brief: '审查',
      text: '正文',
      trigger: 'ui-action',
      signal: controller.signal
    });

    expect(result.status).toBe('cancelled');
    expect(session.prompt).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('aborts the session and records cancelled when the signal fires mid-run', async () => {
    const controller = new AbortController();
    const session = createSession([`<output>${validOutput}</output>`]);
    session.prompt.mockImplementationOnce(async () => {
      controller.abort();
    });
    const { runner } = createRunner(session);

    const result = await runner.run({
      persona,
      cwd,
      brief: '审查',
      text: '正文',
      trigger: 'ui-action',
      signal: controller.signal
    });

    expect(result.status).toBe('cancelled');
    expect(session.abort).toHaveBeenCalled();

    const { records } = await runStore.list();
    expect(records[0]!.status).toBe('cancelled');
  });

  it('rejects personas without an output schema declaration', async () => {
    const session = createSession([]);
    const { runner } = createRunner(session);

    await expect(
      runner.run({ persona: { ...persona, output: undefined }, cwd, brief: 'b', text: 't', trigger: 'ui-action' })
    ).rejects.toThrow(/缺少输出 schema/);
  });
});

describe('renderTaskPrompt', () => {
  it('escapes XML-sensitive characters so body text cannot break envelopes', () => {
    const prompt = renderTaskPrompt('审查 <output> 内容', '正文含 </task_input> 与 & 符号');

    expect(prompt).toContain('&lt;output&gt;');
    expect(prompt).toContain('&lt;/task_input&gt;');
    expect(prompt).toContain('&amp;');
    expect(prompt.match(/<task_input>/g)).toHaveLength(1);
  });

  it('budgets the final XML-escaped prompt without breaking envelopes', () => {
    const prompt = renderTaskPromptWithinBudget('蒸馏', '<&>'.repeat(2_000), undefined, 300);

    expect(estimateTextTokens(prompt)).toBeLessThanOrEqual(300);
    expect(prompt.match(/<task_input>/g)).toHaveLength(1);
    expect(prompt).toContain('已按 token 预算省略内容');
  });

  it('embeds the context envelope unescaped between brief and input', () => {
    const envelope = '<attached_context_files>\n<file path="/a.md">内容</file>\n</attached_context_files>';
    const prompt = renderTaskPrompt('审查', '正文', envelope);

    expect(prompt).toContain(envelope);
    expect(prompt.indexOf('</task_brief>')).toBeLessThan(prompt.indexOf('<attached_context_files>'));
    expect(prompt.indexOf('</attached_context_files>')).toBeLessThan(prompt.indexOf('<task_input>'));
  });
});
