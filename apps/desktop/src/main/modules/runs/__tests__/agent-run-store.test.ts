import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunRecord } from '../record';
import { AgentRunStore } from '../store';

/** 构造一条完整记录，createdAt 默认取当前时间（落在"当月"文件）。 */
function buildRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: 'run-1',
    personaId: 'editor',
    execution: 'task',
    trigger: 'user',
    promptTemplateHash: 'hash-abc',
    inputDigest: { brief: '润色第 3 章', files: ['正文/第3章.md'] },
    memoryRefs: ['notes/fear-of-water.md@2024-05-01T00:00:00.000Z'],
    status: 'success',
    usage: { inputTokens: 100, outputTokens: 200 },
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

/** 当前 UTC 月份的 YYYY-MM 串（与 store 的月份文件命名一致）。 */
function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 上一个 UTC 月份的 YYYY-MM 串。 */
function previousYearMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

describe('AgentRunStore', () => {
  let cwd: string;
  let store: AgentRunStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-runs-'));
    store = new AgentRunStore({ cwd });
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('appends records and reads them back in reverse order', async () => {
    const first = buildRecord({ id: 'run-1' });
    const second = buildRecord({ id: 'run-2', status: 'failed' });

    await store.append(first);
    await store.append(second);

    const result = await store.list();

    expect(result.diagnostics).toEqual([]);
    expect(result.records.map(record => record.id)).toEqual(['run-2', 'run-1']);
    expect(result.records[1]).toEqual(first);
  });

  it('splits records into month files by createdAt and lists both current and previous month', async () => {
    const previousMonthIso = `${previousYearMonth()}-15T12:00:00.000Z`;
    const previousRecord = buildRecord({ id: 'run-prev', createdAt: previousMonthIso });
    const currentRecord = buildRecord({ id: 'run-curr' });

    await store.append(previousRecord);
    await store.append(currentRecord);

    const runsDir = path.join(cwd, '.chaptale', 'runs');
    const files = (await fs.readdir(runsDir)).filter(name => name.endsWith('.jsonl'));

    expect(files.toSorted()).toEqual(
      [`agent-runs-${previousYearMonth()}.jsonl`, `agent-runs-${currentYearMonth()}.jsonl`].toSorted()
    );

    const result = await store.list();

    // 倒序：当月记录在前，上月在后。
    expect(result.records.map(record => record.id)).toEqual(['run-curr', 'run-prev']);
  });

  it('skips broken lines with diagnostics instead of throwing', async () => {
    await store.append(buildRecord({ id: 'run-good' }));

    const filePath = path.join(cwd, '.chaptale', 'runs', `agent-runs-${currentYearMonth()}.jsonl`);
    await fs.appendFile(filePath, '{ not-valid-json\n', 'utf8');
    await fs.appendFile(filePath, '{"id":123}\n', 'utf8');
    await store.append(buildRecord({ id: 'run-good-2' }));

    const result = await store.list();

    expect(result.records.map(record => record.id)).toEqual(['run-good-2', 'run-good']);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.filePath).toBe(filePath);
    expect(result.diagnostics.map(diagnostic => diagnostic.line)).toEqual([2, 3]);
  });

  it('filters by personaId and applies limit after reversal', async () => {
    await store.append(buildRecord({ id: 'run-a1', personaId: 'editor' }));
    await store.append(buildRecord({ id: 'run-b1', personaId: 'reviewer' }));
    await store.append(buildRecord({ id: 'run-a2', personaId: 'editor' }));
    await store.append(buildRecord({ id: 'run-a3', personaId: 'editor' }));

    const filtered = await store.list({ personaId: 'editor' });
    expect(filtered.records.map(record => record.id)).toEqual(['run-a3', 'run-a2', 'run-a1']);

    const limited = await store.list({ personaId: 'editor', limit: 2 });
    expect(limited.records.map(record => record.id)).toEqual(['run-a3', 'run-a2']);
  });

  it('returns empty result when no run files exist yet', async () => {
    await expect(store.list()).resolves.toEqual({ records: [], diagnostics: [] });
  });

  it('saves outputs under runs/outputs and returns a portable relative path', async () => {
    const outputRef = await store.saveOutput('run-42', '第三章润色结果……');

    expect(outputRef).toBe('.chaptale/runs/outputs/run-42.json');

    const raw = await fs.readFile(path.join(cwd, ...outputRef.split('/')), 'utf8');
    const parsed = JSON.parse(raw) as { runId: string; rawText: string };

    expect(parsed.runId).toBe('run-42');
    expect(parsed.rawText).toBe('第三章润色结果……');
  });
});
