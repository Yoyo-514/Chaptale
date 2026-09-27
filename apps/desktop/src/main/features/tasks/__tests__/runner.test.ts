import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createDefaultToolCatalog } from '../../../core/tool-protocol/catalog';
import { TaskRunner } from '../runner';
import type { TaskSession } from '../session';

const reviewer: PersonaDefinition = {
  id: 'continuity-reviewer',
  name: '连续性审查',
  type: 'review',
  execution: 'task',
  output: 'continuity-issues',
  body: '审查',
  source: 'builtin'
};

function createRunner() {
  const session: TaskSession = {
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    getLastAssistantText: () => undefined,
    getUsage: () => ({ inputTokens: 0, outputTokens: 0 }),
    dispose: vi.fn()
  };
  const createTaskSession = vi.fn(async (..._args: unknown[]) => session);
  const runner = new TaskRunner(
    { createTaskSession },
    { append: vi.fn(async () => undefined) } as never,
    {} as never,
    createDefaultToolCatalog()
  );

  return { runner, createTaskSession };
}

describe('TaskRunner 授权转发', () => {
  it('委派子任务把宿主会话与子任务名交给会话工厂；同样带 parentSessionId 的后台任务不转发', async () => {
    const { runner, createTaskSession } = createRunner();
    // 预先取消：会话创建后立即以 cancelled 收尾，只观察工厂收到的转发信息。
    const signal = AbortSignal.abort();

    await runner.run({
      persona: reviewer,
      cwd: '/workspace',
      brief: '审查第三章',
      text: '',
      trigger: 'delegate',
      parentSessionId: 'chat-1',
      signal
    });
    // 会话压缩这类后台任务不是作者此刻发起的：授权请求不该突然弹进对话。
    await runner.run({
      persona: reviewer,
      cwd: '/workspace',
      brief: '生成检查点',
      text: '',
      trigger: 'ui-action',
      parentSessionId: 'chat-1',
      signal
    });

    expect(createTaskSession.mock.calls[0]?.[3]).toEqual({ parentSessionId: 'chat-1', requester: '连续性审查' });
    expect(createTaskSession.mock.calls[1]?.[3]).toBeUndefined();
  });
});
