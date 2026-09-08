import { describe, expect, it } from 'vitest';

import type { AgentRunRecord } from '@chaptale/shared';

import { runReference, runTitle, verifyRunOutput } from '../presentation';

const record: AgentRunRecord = {
  id: 'run-1',
  personaId: 'draft',
  execution: 'task',
  trigger: 'ui-action',
  createdAt: '2026-01-01',
  promptTemplateHash: '',
  memoryRefs: [],
  inputDigest: {},
  usage: { inputTokens: 0, outputTokens: 0 },
  status: 'success'
};
describe('运行展示', () => {
  it('来源只允许跳转作品相对文本路径，不把缺失指纹显示为验证成功', () => {
    expect(runReference(`角色/林晚.md#${'a'.repeat(64)}`)).toEqual({
      sourcePath: '角色/林晚.md',
      hash: 'a'.repeat(64),
      canOpen: true
    });
    for (const source of [
      '../secret.md',
      'author:memory/preference.md',
      '.chaptale/memory/notes/a.md',
      'https://example.com/a.md'
    ])
      expect(runReference(source).canOpen).toBe(false);
    expect(runReference('角色/林晚.md@2026-01-01').hash).toBeUndefined();
  });
  it('标题逐级降级，不展示空白命令', () => {
    expect(runTitle(record)).toBe('候选起草');
    expect(runTitle({ ...record, inputDigest: { brief: ' ', files: ['正文/一.md'] } })).toBe('正文/一.md');
    expect(runTitle({ ...record, inputDigest: { brief: '本次任务' } })).toBe('本次任务');
  });
  it('验证输出归属和指纹，旧记录不伪造校验结果', () => {
    expect(() => verifyRunOutput(record, null)).toThrow('不可读');
    expect(() => verifyRunOutput(record, { runId: 'other' })).toThrow('归属');
    expect(() => verifyRunOutput({ ...record, outputHash: 'a'.repeat(64) }, { runId: record.id })).toThrow('已变化');
    expect(() =>
      verifyRunOutput({ ...record, outputHash: 'a'.repeat(64) }, { runId: record.id, contentHash: 'b'.repeat(64) })
    ).toThrow('已变化');
    expect(() =>
      verifyRunOutput({ ...record, outputHash: 'a'.repeat(64) }, { runId: record.id, contentHash: 'a'.repeat(64) })
    ).not.toThrow();
    expect(() => verifyRunOutput(record, { runId: record.id })).not.toThrow();
  });
});
