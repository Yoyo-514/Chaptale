import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReviewJob } from '@chaptale/shared';

import { MemoryService } from '../../memory/service';
import { ReviewFeedbackStore } from '../feedback';
import { ReviewWorkflowStore } from '../workflow-store';

let scratch: string;
let root: string;
let author: string;
let reviews: ReviewWorkflowStore;
let feedback: ReviewFeedbackStore;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const text = '第一句。第二句。';
async function fixture(id: string, count = 5) {
  const output = JSON.stringify({
    summary: '节奏问题',
    issues: Array.from({ length: count }, () => ({
      agentType: 'style',
      type: 'flat_rhythm',
      severity: 'low',
      quote: '第一句。',
      reason: '句式重复',
      suggestion: '调整节奏'
    }))
  });
  const job: ReviewJob = {
    id,
    personaId: 'style-reviewer',
    targetPath: 'chapter.md',
    text,
    baselineHash: hash(text),
    model: { provider: 'fixture', modelId: 'stored-review' },
    memoryRefs: [],
    excludedSources: [],
    status: 'running',
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z'
  };
  await reviews.create(root, job);
  await writeFile(path.join(root, `.chaptale/reviews/${id}.json`), output);
  await reviews.update(root, id, { status: 'done', runId: id, outputRef: `.chaptale/reviews/${id}.json` });
  return output;
}
async function storedActions(id: string, statuses: Array<'ignored' | 'resolved' | 'open'>, offset = 0) {
  const details = await reviews.read(root, id);
  const issues = Object.fromEntries(
    statuses.map((status, index) => [
      String(index),
      { status, updatedAt: new Date(Date.UTC(2026, 8, 8, 0, 0, offset + index)).toISOString() }
    ])
  );
  await writeFile(
    path.join(root, `.chaptale/reviews/${id}.state.json`),
    JSON.stringify({
      outputHash: details.state!.outputHash,
      issues
    })
  );
}
beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'chaptale-feedback-'));
  root = path.join(scratch, 'workspace');
  author = path.join(scratch, 'author');
  await mkdir(root);
  await mkdir(author);
  reviews = new ReviewWorkflowStore();
  feedback = new ReviewFeedbackStore(reviews, author);
});
afterEach(async () => {
  expect(path.dirname(path.resolve(scratch))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(scratch).startsWith('chaptale-feedback-')).toBe(true);
  await rm(scratch, { recursive: true, force: true });
});
describe('审查偏好确认', () => {
  it('空历史和不足五条忽略不生成建议，读取不创建偏好', async () => {
    expect((await feedback.list(root)).suggestions).toEqual([]);
    await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3], 'ignored');
    expect((await feedback.list(root)).suggestions).toEqual([]);
    expect(await readdir(author)).toEqual([]);
  });
  it('不同问题跨运行累计，重复点击和重启不改变依据', async () => {
    await fixture('one', 3);
    await fixture('two', 2);
    await reviews.resolve(root, 'one', [0, 1, 2], 'ignored');
    await reviews.resolve(root, 'two', [0, 1], 'ignored');
    const before = (await feedback.list(root)).suggestions[0]!;
    expect(before.ignoredCount).toBe(5);
    expect(before.reviewIds.toSorted()).toEqual(['one', 'two']);
    await reviews.resolve(root, 'one', [0, 0, 1], 'ignored');
    expect((await feedback.list(root)).suggestions).toEqual([before]);
    expect((await new ReviewFeedbackStore(new ReviewWorkflowStore(), author).list(root)).suggestions).toEqual([before]);
    await reviews.resolve(root, 'two', [1], 'open');
    expect((await feedback.list(root)).suggestions).toEqual([]);
    await reviews.resolve(root, 'two', [1], 'ignored');
    expect((await feedback.list(root)).suggestions[0]!.ignoredCount).toBe(5);
  });
  it('非忽略会中断当前处理序列，再次连续五条才建议', async () => {
    await fixture('one', 11);
    await storedActions('one', [...Array(5).fill('ignored'), 'resolved', ...Array(4).fill('ignored')]);
    expect((await feedback.list(root)).suggestions).toEqual([]);
    await storedActions('one', [...Array(5).fill('ignored'), 'resolved', ...Array(5).fill('ignored')]);
    expect((await feedback.list(root)).suggestions[0]!.ignoredCount).toBe(5);
  });
  it('同一毫秒的混合状态不猜测先后次序', async () => {
    await fixture('one', 6);
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const detail = await reviews.resolve(root, 'one', [5], 'resolved');
    const issues = Object.fromEntries(
      Object.entries(detail.state!.issues).map(([index, item]) => [
        index,
        { ...item, updatedAt: '2026-09-08T00:00:00.000Z' }
      ])
    );
    await writeFile(path.join(root, '.chaptale/reviews/one.state.json'), JSON.stringify({ ...detail.state, issues }));
    expect((await feedback.list(root)).suggestions).toEqual([]);
  });
  it('确认之前不注入，确认后仅当前 reviewer 生效并记录来源指纹', async () => {
    const original = await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const suggestion = (await feedback.list(root)).suggestions[0]!;
    expect((await feedback.forPersona('style-reviewer')).prompt).toBe('');
    const confirmed = '降低节奏检查频率，但保留严重问题。<source>';
    const result = await feedback.resolve(root, suggestion.id, 'accept', confirmed);
    expect(result.suggestions).toEqual([]);
    expect(result.preferences[0]!.text).toBe(confirmed);
    expect((await feedback.forPersona('style-reviewer')).prompt).toContain('&lt;source&gt;');
    expect((await feedback.forPersona('style-reviewer')).memoryRefs).toEqual([
      `${result.preferences[0]!.sourceRef}#${result.preferences[0]!.contentHash}`
    ]);
    for (const persona of ['character-reviewer', 'continuity-reviewer', 'companion', 'draft'])
      expect(await feedback.forPersona(persona)).toEqual({ prompt: '', memoryRefs: [] });
    expect((await new MemoryService({ chaptaleRootDir: author }).readSections(root)).preferences).toBeUndefined();
    expect(await readFile(path.join(root, '.chaptale/reviews/one.json'), 'utf8')).toBe(original);
    expect((await feedback.resolve(root, suggestion.id, 'accept', confirmed)).preferences).toHaveLength(1);
  });
  it('并发确认只创建一份偏好，重复不同文本不能覆盖', async () => {
    await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const suggestion = (await feedback.list(root)).suggestions[0]!;
    await Promise.all([
      feedback.resolve(root, suggestion.id, 'accept', suggestion.text),
      feedback.resolve(root, suggestion.id, 'accept', suggestion.text)
    ]);
    expect((await feedback.preferences()).preferences).toHaveLength(1);
    await expect(feedback.resolve(root, suggestion.id, 'accept', '另一个内容')).rejects.toThrow('依据已变化');
  });
  it('不再提示按作品保存，不会创建作者偏好', async () => {
    await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const suggestion = (await feedback.list(root)).suggestions[0]!;
    await feedback.resolve(root, suggestion.id, 'dismiss');
    await fixture('two');
    await reviews.resolve(root, 'two', [0, 1, 2, 3, 4], 'ignored');
    expect((await new ReviewFeedbackStore(reviews, author).list(root)).suggestions).toEqual([]);
    expect(await readdir(author)).toEqual([]);
  });
  it('依据变化、空偏好和无效 Unicode 拒绝确认', async () => {
    await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const suggestion = (await feedback.list(root)).suggestions[0]!;
    for (const invalid of ['', '   ', 'x'.repeat(4001), '\0', '\uD800'])
      await expect(feedback.resolve(root, suggestion.id, 'accept', invalid)).rejects.toThrow('内容无效');
    await reviews.resolve(root, 'one', [0], 'resolved');
    await expect(feedback.resolve(root, suggestion.id, 'accept', suggestion.text)).rejects.toThrow('依据已变化');
    expect(await readdir(author)).toEqual([]);
  });
  it('输出篡改和损坏记录阻止基于不完整历史生成建议', async () => {
    await fixture('one');
    await fixture('two');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    await writeFile(path.join(root, '.chaptale/reviews/two.json'), '{}');
    expect((await feedback.list(root)).diagnostics.length).toBeGreaterThan(0);
    expect((await feedback.list(root)).suggestions).toEqual([]);
    await writeFile(path.join(root, '.chaptale/reviews/feedback.json'), '{"style-reviewer:flat_rhythm":1}');
    await expect(feedback.list(root)).rejects.toThrow('记录损坏');
  });
  it('偏好路径链接不会写到外部目录', async () => {
    await fixture('one');
    await reviews.resolve(root, 'one', [0, 1, 2, 3, 4], 'ignored');
    const suggestion = (await feedback.list(root)).suggestions[0]!;
    const outside = path.join(scratch, 'outside');
    await mkdir(outside);
    await mkdir(path.join(author, 'memory'));
    await symlink(outside, path.join(author, 'memory/preferences'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await feedback.preferences()).diagnostics).toHaveLength(1);
    await expect(feedback.resolve(root, suggestion.id, 'accept', suggestion.text)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
});
