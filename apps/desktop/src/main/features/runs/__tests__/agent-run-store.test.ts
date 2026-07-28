import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function isSymlinkPrivilegeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['EPERM', 'EACCES', 'EINVAL'].includes(String((error as { code: unknown }).code))
  );
}

async function createSymlinkOrSkip(target: string, linkPath: string, type: 'dir' | 'file'): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (isSymlinkPrivilegeError(error)) {
      return false;
    }

    throw error;
  }
}

describe('AgentRunStore', () => {
  let cwd: string;
  let store: AgentRunStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-runs-'));
    store = new AgentRunStore({ resolveCwd: () => cwd });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('rejects unsafe runId values before building raw output file paths', async () => {
    const unsafeRunIds = ['', '.', '..', 'run.state', 'nested/run', 'nested\\run', 'C:\\tmp\\run', '/tmp/run', 'run:1'];

    for (const runId of unsafeRunIds) {
      await expect(store.saveOutput(runId, '不能落盘', cwd)).rejects.toThrow(/runId/);
    }
  });

  it('uses collision-resistant temporary files for concurrent raw output saves of the same runId', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);

    await Promise.all(Array.from({ length: 8 }, (_, index) => store.saveOutput('same-run', `raw-${index}`, cwd)));

    const saved = JSON.parse(
      await fs.readFile(path.join(cwd, '.chaptale', 'runs', 'outputs', 'same-run.json'), 'utf8')
    ) as {
      runId: string;
      rawText: string;
    };
    expect(saved.runId).toBe('same-run');
    expect(saved.rawText).toMatch(/^raw-[0-7]$/);
    const files = await fs.readdir(path.join(cwd, '.chaptale', 'runs', 'outputs'));
    expect(files.filter(file => file.endsWith('.tmp'))).toEqual([]);
  });

  it('reads back saved outputs by outputRef', async () => {
    const outputRef = await store.saveOutput('run-50', '审查结果正文');

    await expect(store.readOutput(outputRef)).resolves.toEqual({ runId: 'run-50', rawText: '审查结果正文' });
  });

  it('rejects output refs that escape the outputs directory or are not direct output files', async () => {
    // 路径穿越、目录外引用、状态文件与子目录引用一律返回 null，不读任意文件。
    await expect(store.readOutput('.chaptale/runs/outputs/../../../package.json')).resolves.toBeNull();
    await expect(store.readOutput('package.json')).resolves.toBeNull();
    await expect(store.readOutput('.chaptale/runs/agent-runs-2026-07.jsonl')).resolves.toBeNull();
    await expect(store.readOutput('.chaptale/runs/outputs/run-1.state.json')).resolves.toBeNull();
    await expect(store.readOutput('.chaptale/runs/outputs/nested/run-1.json')).resolves.toBeNull();
  });

  it('does not follow a symlinked raw outputs directory for save, read or remove', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-outputs-outside-'));
    const outputsDir = path.join(cwd, '.chaptale', 'runs', 'outputs');
    await fs.mkdir(path.dirname(outputsDir), { recursive: true });

    if (!(await createSymlinkOrSkip(outsideDir, outputsDir, 'dir'))) {
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      const outsideFile = path.join(outsideDir, 'run-1.json');
      await fs.writeFile(outsideFile, JSON.stringify({ runId: 'run-1', rawText: 'leaked' }), 'utf8');

      await expect(store.saveOutput('run-1', '不能写到外部', cwd)).rejects.toThrow();
      await expect(store.readOutput('.chaptale/runs/outputs/run-1.json')).resolves.toBeNull();
      await store.removeOutput('.chaptale/runs/outputs/run-1.json', cwd);
      await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe(
        JSON.stringify({ runId: 'run-1', rawText: 'leaked' })
      );
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not read, remove or overwrite a symlinked raw output file', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-output-file-outside-'));
    const outsideFile = path.join(outsideDir, 'run-1.json');
    const outputsDir = path.join(cwd, '.chaptale', 'runs', 'outputs');
    const linkedFile = path.join(outputsDir, 'run-1.json');
    await fs.mkdir(outputsDir, { recursive: true });
    await fs.writeFile(outsideFile, JSON.stringify({ runId: 'run-1', rawText: 'leaked' }), 'utf8');

    if (!(await createSymlinkOrSkip(outsideFile, linkedFile, 'file'))) {
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      await expect(store.readOutput('.chaptale/runs/outputs/run-1.json')).resolves.toBeNull();
      await store.removeOutput('.chaptale/runs/outputs/run-1.json', cwd);
      await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe(
        JSON.stringify({ runId: 'run-1', rawText: 'leaked' })
      );
      await expect(store.saveOutput('run-1', '不能覆盖外部', cwd)).rejects.toThrow();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns null for missing or malformed output files', async () => {
    await expect(store.readOutput('.chaptale/runs/outputs/missing.json')).resolves.toBeNull();

    const badPath = path.join(cwd, '.chaptale', 'runs', 'outputs', 'bad.json');
    await fs.mkdir(path.dirname(badPath), { recursive: true });
    await fs.writeFile(badPath, '不是 JSON', 'utf8');
    await expect(store.readOutput('.chaptale/runs/outputs/bad.json')).resolves.toBeNull();
  });

  it('removes only direct safe output refs under runs/outputs', async () => {
    const outputRef = await store.saveOutput('run-remove', '待删除输出');
    const outsidePath = path.join(cwd, '.chaptale', 'keep.json');
    const statePath = path.join(cwd, '.chaptale', 'runs', 'outputs', 'run-remove.state.json');
    const nestedPath = path.join(cwd, '.chaptale', 'runs', 'outputs', 'nested', 'run-remove.json');
    await fs.writeFile(outsidePath, '不能删除', 'utf8');
    await fs.writeFile(statePath, '不能删除状态文件', 'utf8');
    await fs.mkdir(path.dirname(nestedPath), { recursive: true });
    await fs.writeFile(nestedPath, '不能删除子目录文件', 'utf8');

    await store.removeOutput(outputRef, cwd);

    await expect(fs.readFile(path.join(cwd, ...outputRef.split('/')), 'utf8')).rejects.toThrow();
    await store.removeOutput('.chaptale/runs/outputs/../../keep.json', cwd);
    await store.removeOutput('.chaptale/runs/outputs/run-remove.state.json', cwd);
    await store.removeOutput('.chaptale/runs/outputs/nested/run-remove.json', cwd);
    await expect(fs.readFile(outsidePath, 'utf8')).resolves.toBe('不能删除');
    await expect(fs.readFile(statePath, 'utf8')).resolves.toBe('不能删除状态文件');
    await expect(fs.readFile(nestedPath, 'utf8')).resolves.toBe('不能删除子目录文件');
  });
});
