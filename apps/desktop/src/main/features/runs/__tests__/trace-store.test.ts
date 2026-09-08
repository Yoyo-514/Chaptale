import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunRecord } from '@chaptale/shared';

import { AgentRunStore } from '../store';

let scratch: string;
let root: string;
let store: AgentRunStore;
function record(id: string, createdAt = '2026-01-01T00:00:00.000Z'): AgentRunRecord {
  return {
    id,
    createdAt,
    personaId: 'draft',
    execution: 'task',
    trigger: 'ui-action',
    promptTemplateHash: 'a'.repeat(64),
    model: { provider: 'fixture', modelId: 'stored-output' },
    inputDigest: { brief: `起草 ${id}`, files: ['正文/第一章.md'], packId: 'pack-1' },
    memoryRefs: ['角色/林晚.md#' + 'b'.repeat(64)],
    status: 'success',
    usage: { inputTokens: 100, outputTokens: 25 }
  };
}
beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'chaptale-run-trace-'));
  root = path.join(scratch, 'workspace');
  await mkdir(root);
  store = new AgentRunStore({ resolveCwd: () => root });
});
afterEach(async () => {
  expect(path.dirname(path.resolve(scratch))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(scratch).startsWith('chaptale-run-trace-')).toBe(true);
  await rm(scratch, { recursive: true, force: true });
});
describe('运行追溯', () => {
  it('跨年份查询并保留模型、参考和来源元数据', async () => {
    await store.append(record('old', '2020-01-01T00:00:00.000Z'));
    await store.append(record('new'));
    const result = await store.list();
    expect(result.records.map(value => value.id)).toEqual(['new', 'old']);
    expect((await store.list({ runId: 'old' })).records).toEqual([record('old', '2020-01-01T00:00:00.000Z')]);
  });
  it('同时间按追加顺序排序，插入新记录不使下一页重复', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await store.append(record(id));
    const first = await store.list({ limit: 2 });
    expect(first.records.map(value => value.id)).toEqual(['d', 'c']);
    expect(first.nextCursor).toBe('c');
    await store.append(record('e'));
    const second = await store.list({ limit: 2, before: first.nextCursor });
    expect(second.records.map(value => value.id)).toEqual(['b', 'a']);
    expect(second.nextCursor).toBeUndefined();
    await expect(store.list({ before: 'missing' })).rejects.toThrow('分页依据');
  });
  it('筛选遍历全部月份而不是只过滤首屏', async () => {
    await store.append(record('old', '2020-01-01T00:00:00.000Z'));
    await store.append({ ...record('failed'), status: 'failed', personaId: 'rewriter' });
    expect((await store.list({ query: 'old' })).records[0]?.id).toBe('old');
    expect((await store.list({ query: '第一章', status: 'failed', personaId: 'rewriter' })).records[0]?.id).toBe(
      'failed'
    );
    expect((await store.list({ status: 'cancelled' })).records).toEqual([]);
    await expect(store.list({ rootPath: `${root}-old` })).rejects.toThrow('工作区已切换');
    for (const limit of [0, -1, 201, 0.5]) await expect(store.list({ limit })).rejects.toThrow('分页');
  });
  it('完整校验坏行和重复 id，残缺末行不吞掉后续追加', async () => {
    await store.append(record('a'));
    const filename = path.join(root, '.chaptale/runs/agent-runs-2026-01.jsonl');
    await appendFile(
      filename,
      '{"id":"incomplete","personaId":"draft","status":"success","createdAt":"2026-01-01"}\n{broken'
    );
    await store.append(record('b'));
    await appendFile(filename, `${JSON.stringify(record('a'))}\n`);
    const result = await store.list();
    expect(result.records.map(value => value.id)).toEqual(['b', 'a']);
    expect(result.diagnostics.map(value => value.line)).toEqual([2, 3, 5]);
  });
  it('并发追加不交叉或丢行', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) => store.append(record(`run-${index}`))));
    const result = await store.list();
    expect(result.diagnostics).toEqual([]);
    expect(new Set(result.records.map(value => value.id)).size).toBe(30);
  });
  it('恶意时间和不完整记录不会创建任意日志文件', async () => {
    for (const createdAt of ['../elsewhere', '2026-13-02', 'bad', '2026-00-00T00:00:00Z'])
      await expect(store.append(record('bad', createdAt))).rejects.toThrow();
    await expect(store.append({ ...record('bad'), usage: { inputTokens: -1, outputTokens: 0 } })).rejects.toThrow(
      '字段无效'
    );
    expect(await readdir(root)).toEqual([]);
  });
  it('月文件或内部目录链接不可读取和追加', async () => {
    const outside = path.join(scratch, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'agent-runs-2026-01.jsonl'), `${JSON.stringify(record('outside'))}\n`);
    await mkdir(path.join(root, '.chaptale'));
    await symlink(outside, path.join(root, '.chaptale/runs'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(store.list()).rejects.toThrow();
    await expect(store.append(record('inside'))).rejects.toThrow();
    expect(await readFile(path.join(outside, 'agent-runs-2026-01.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(record('outside'))}\n`
    );
  });
  it('新记录绑定输出字节指纹，同 run 输出不能被重写', async () => {
    const outputRef = await store.saveOutput('one', '原始输出', root);
    await store.append({ ...record('one'), outputRef });
    const raw = await readFile(path.join(root, outputRef));
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    expect((await store.list()).records[0]?.outputHash).toBe(expectedHash);
    expect((await store.readOutput(outputRef))?.contentHash).toBe(expectedHash);
    await expect(store.saveOutput('one', '替换内容', root)).rejects.toThrow();
    expect(await readFile(path.join(root, outputRef))).toEqual(raw);
    await writeFile(path.join(root, outputRef), JSON.stringify({ runId: 'one', rawText: '外部修改' }));
    expect((await store.readOutput(outputRef))?.contentHash).not.toBe(expectedHash);
    expect((await store.list()).records[0]?.outputHash).toBe(expectedHash);
  });
  it('输出归属和指纹不一致不登记，旧记录缺指纹仍如实读取', async () => {
    await store.append(record('legacy'));
    expect((await store.list()).records[0]).not.toHaveProperty('outputHash');
    const outputRef = await store.saveOutput('output-owner', '正文');
    await expect(store.append({ ...record('different'), outputRef })).rejects.toThrow('引用与记录不匹配');
    await expect(store.append({ ...record('output-owner'), outputRef, outputHash: '0'.repeat(64) })).rejects.toThrow(
      '输出已变化'
    );
    await writeFile(path.join(root, outputRef), JSON.stringify({ runId: 'different', rawText: '正文' }));
    expect(await store.readOutput(outputRef)).toBeNull();
  });
});
