import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompactionSummaryStore } from '../compaction-summary-store';
import { evaluateContextPressure } from '../context-pressure';

describe('evaluateContextPressure', () => {
  it('prompts the author when context usage reaches the 70 percent threshold', () => {
    expect(evaluateContextPressure({ tokens: 70_000, contextWindow: 100_000, percent: 70 })).toEqual({
      tokens: 70_000,
      contextWindow: 100_000,
      percent: 70,
      thresholdPercent: 70,
      shouldPrompt: true
    });
  });

  it('does not prompt below the threshold', () => {
    expect(evaluateContextPressure({ tokens: 69_999, contextWindow: 100_000, percent: 69.999 })).toMatchObject({
      shouldPrompt: false
    });
  });

  it('keeps context pressure unknown immediately after compaction', () => {
    expect(evaluateContextPressure({ tokens: null, contextWindow: 100_000, percent: null })).toEqual({
      tokens: null,
      contextWindow: 100_000,
      percent: null,
      thresholdPercent: 70,
      shouldPrompt: false
    });
  });
});

describe('CompactionSummaryStore', () => {
  let cwd: string;
  let store: CompactionSummaryStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-compaction-'));
    store = new CompactionSummaryStore();
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('saves a traceable summary under workspace memory summaries', async () => {
    const result = await store.save({
      sessionId: 'session-1',
      cwd,
      reason: 'manual',
      checkpointId: 'entry-42',
      distillerRunId: 'run-distill',
      memoryRefs: ['author:preferences', 'workspace:设定/创作守则.md'],
      summary: '## 当前目标\n继续完成第三章。',
      tokensBefore: 71_000,
      createdAt: '2026-07-12T08:00:00.000Z'
    });

    expect(result.outputRef).toMatch(/^\.chaptale\/memory\/summaries\/compactions\/session-1-[a-f0-9]{8}\.md$/);

    const content = await fs.readFile(path.join(cwd, ...result.outputRef.split('/')), 'utf8');
    expect(content).toContain('kind: summary');
    expect(content).toContain('source: "session:session-1"');
    expect(content).toContain('reason: "manual"');
    expect(content).toContain('checkpointId: "entry-42"');
    expect(content).toContain('distillerRunId: "run-distill"');
    expect(content).toContain('memoryRefs: ["author:preferences","workspace:设定/创作守则.md"]');
    expect(content).toContain('tokensBefore: 71000');
    expect(content).toContain('## 当前目标\n继续完成第三章。');
  });

  it('sanitizes the session id used in the filename', async () => {
    const result = await store.save({
      sessionId: '../../escape\\attempt',
      cwd,
      reason: 'threshold',
      checkpointId: 'entry-escape',
      distillerRunId: 'run-escape',
      memoryRefs: [],
      summary: '摘要',
      tokensBefore: 100,
      createdAt: '2026-07-12T08:00:00.000Z'
    });

    expect(result.outputRef).not.toContain('..');
    expect(path.resolve(cwd, result.outputRef).startsWith(path.resolve(cwd, '.chaptale', 'memory', 'summaries'))).toBe(
      true
    );
  });

  it('同一检查点重试时复用已原子落盘的摘要', async () => {
    const base = {
      sessionId: 'session-1',
      cwd,
      reason: 'overflow' as const,
      checkpointId: 'entry-stable',
      distillerRunId: 'run-first',
      memoryRefs: [],
      summary: '第一次摘要',
      tokensBefore: 80_000,
      createdAt: '2026-07-12T08:00:00.000Z'
    };
    const first = await store.save(base);
    const retried = await store.save({
      ...base,
      distillerRunId: 'run-second',
      summary: '第二次摘要',
      createdAt: '2026-07-13T08:00:00.000Z'
    });

    expect(retried.outputRef).toBe(first.outputRef);
    expect(retried.summary).toBe('第一次摘要');
    const content = await fs.readFile(path.join(cwd, ...first.outputRef.split('/')), 'utf8');
    expect(content).toContain('第一次摘要');
    expect(content).not.toContain('第二次摘要');
  });

  it('并发发布同一检查点时所有调用都返回胜出文件的同一正文', async () => {
    const base = {
      sessionId: 'session-race',
      cwd,
      reason: 'threshold' as const,
      checkpointId: 'entry-race',
      distillerRunId: 'run-race',
      memoryRefs: [],
      tokensBefore: 75_000
    };
    const [left, right] = await Promise.all([
      store.save({ ...base, summary: '并发摘要 A' }),
      store.save({ ...base, summary: '并发摘要 B' })
    ]);

    expect(left.outputRef).toBe(right.outputRef);
    expect(left.summary).toBe(right.summary);
    const content = await fs.readFile(path.join(cwd, ...left.outputRef.split('/')), 'utf8');
    expect(content).toContain(left.summary);
  });

  it('已有检查点损坏时拒绝复用，避免把空摘要写进会话树', async () => {
    const input = {
      sessionId: 'session-broken',
      cwd,
      reason: 'manual' as const,
      checkpointId: 'entry-broken',
      distillerRunId: 'run-broken',
      memoryRefs: [],
      summary: '有效摘要',
      tokensBefore: 70_000
    };
    const saved = await store.save(input);
    await fs.writeFile(path.join(cwd, ...saved.outputRef.split('/')), '---\n损坏内容', 'utf8');

    await expect(store.save(input)).rejects.toThrow('已有会话检查点文件损坏');
  });
});
