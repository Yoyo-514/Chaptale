import { describe, expect, it } from 'vitest';

import { AgentRunsListResultValidator, TaskListRunsArgsValidator } from '../tasks';

describe('运行历史契约', () => {
  it('分页和查询有边界，允许按旧 run 定位', () => {
    expect(TaskListRunsArgsValidator.Check([{ limit: 50, before: 'run-1', rootPath: 'E:/story' }])).toBe(true);
    expect(TaskListRunsArgsValidator.Check([{ runId: 'old-run', status: 'failed', query: '第一章' }])).toBe(true);
    for (const request of [{ limit: 201 }, { limit: 0 }, { status: 'running' }, { query: 'x'.repeat(501) }])
      expect(TaskListRunsArgsValidator.Check([request])).toBe(false);
  });
  it('模型与输出指纹不会在响应校验时丢失，兼容未记录的旧字段', () => {
    const record = {
      id: 'run-1',
      personaId: 'draft',
      execution: 'task',
      trigger: 'ui-action',
      promptTemplateHash: 'a'.repeat(64),
      inputDigest: {},
      memoryRefs: [],
      status: 'success',
      usage: { inputTokens: 0, outputTokens: 0 },
      createdAt: '2026-09-08'
    };
    expect(AgentRunsListResultValidator.Check({ records: [record], diagnostics: [] })).toBe(true);
    expect(
      AgentRunsListResultValidator.Check({
        records: [{ ...record, model: { provider: 'fixture', modelId: 'stored' }, outputHash: 'b'.repeat(64) }],
        diagnostics: [],
        nextCursor: 'run-1'
      })
    ).toBe(true);
    expect(
      AgentRunsListResultValidator.Check({
        records: [{ ...record, usage: { inputTokens: -1, outputTokens: 0 } }],
        diagnostics: []
      })
    ).toBe(false);
  });
});
