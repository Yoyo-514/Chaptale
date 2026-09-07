import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import type { ReferencePack, ReviewJob } from '@chaptale/shared';

import { reviewReference } from '../service';
import { ReviewWorkflowStore } from '../workflow-store';

let root: string;
let store: ReviewWorkflowStore;
const result = {
  summary: '两处节奏问题',
  issues: ['第一句。', '第二句。'].map(quote => ({
    agentType: 'style',
    type: 'flat_rhythm',
    severity: 'low',
    quote,
    reason: '句式重复',
    suggestion: '调整节奏'
  }))
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(id = 'job-1') {
  const job: ReviewJob = {
    id,
    personaId: 'style-reviewer',
    targetPath: 'chapter.md',
    text: '第一句。\n第二句。',
    baselineHash: hash('第一句。\n第二句。'),
    model: { provider: 'fixture', modelId: 'stored-review' },
    memoryRefs: [],
    excludedSources: [],
    status: 'done',
    runId: id,
    outputRef: `.chaptale/reviews/${id}.json`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await store.create(root, job);
  await writeFile(path.join(root, job.outputRef!), JSON.stringify(result));
  return job;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-review-workflow-'));
  store = new ReviewWorkflowStore();
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-review-workflow-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});
describe('审查留档与处理状态', () => {
  it('面板数据来自原始输出，状态另存且重启可恢复', async () => {
    const job = await fixture();
    expect((await store.read(root, job.id)).result).toEqual(result);
    const raw = await readFile(path.join(root, job.outputRef!), 'utf8');
    await store.resolve(root, job.id, [0], 'ignored');
    expect(await readFile(path.join(root, job.outputRef!), 'utf8')).toBe(raw);
    const restored = await new ReviewWorkflowStore().read(root, job.id);
    expect(restored.state?.issues['0']?.status).toBe('ignored');
    expect(restored.result).toEqual(result);
  });
  it('并发处理不丢状态，支持重新打开且无效索引不写盘', async () => {
    await fixture();
    await Promise.all([store.resolve(root, 'job-1', [0], 'resolved'), store.resolve(root, 'job-1', [1], 'ignored')]);
    expect((await store.read(root, 'job-1')).state?.issues).toMatchObject({
      0: { status: 'resolved' },
      1: { status: 'ignored' }
    });
    await expect(store.resolve(root, 'job-1', [10], 'ignored')).rejects.toThrow('选择无效');
    await store.resolve(root, 'job-1', [0], 'open');
    expect((await store.read(root, 'job-1')).state?.issues['0']?.status).toBe('open');
  });
  it('状态绑定输出 hash，外部改动不会套用旧状态', async () => {
    const job = await fixture();
    await store.resolve(root, job.id, [0], 'resolved');
    await writeFile(path.join(root, job.outputRef!), JSON.stringify({ ...result, summary: '已改变' }));
    await expect(store.read(root, job.id)).rejects.toThrow('已被修改');
  });
  it('一条任务失败不影响其他任务，列表不传输全文', async () => {
    await fixture('one');
    await fixture('two');
    await store.update(root, 'one', { status: 'cancelled' });
    expect((await store.read(root, 'one')).result).toBeNull();
    expect((await store.read(root, 'two')).result).toEqual(result);
    const list = await store.list(root);
    expect(list.jobs).toHaveLength(2);
    expect(list.jobs[0]).not.toHaveProperty('text');
  });
  it('非法输出引用、坏记录和目录逃逸不被当成有效结果', async () => {
    await fixture();
    await store.update(root, 'job-1', { outputRef: 'chapter.md' });
    await expect(store.read(root, 'job-1')).rejects.toThrow('引用不合法');
    await writeFile(path.join(root, '.chaptale/reviews/jobs/bad.json'), '{}');
    expect((await store.list(root)).diagnostics).toHaveLength(1);
    await expect(store.read(root, '../job-1')).rejects.toThrow('id 不合法');
  });
  it('没有输出文件不使用任务内联结果兜底', async () => {
    const job = await fixture();
    await store.update(root, job.id, { runId: 'missing', outputRef: '.chaptale/reviews/missing.json' });
    await expect(store.read(root, job.id)).rejects.toThrow();
  });
  it('审查剔除 notes，保留已确认参考的顺序和真实读取清单', () => {
    const createSection = (sourcePath: string, content: string) => ({
      sourcePath,
      content,
      title: sourcePath,
      mode: 'full' as const,
      pinned: true,
      sourceHash: hash(content),
      updatedAt: '2026-09-08',
      chars: content.length,
      tokens: content.length
    });
    const pack: ReferencePack = {
      id: 'pack',
      createdAt: '2026-09-08',
      goal: '审查',
      sections: [
        createSection('角色/甲.md', '已确认'),
        createSection('.chaptale/memory/notes/猜测.md', '不能发送'),
        createSection('.chaptale/memory/summaries/recent.md', '摘要')
      ],
      budgetChars: 9000,
      chars: 10,
      tokens: 10,
      prompt: ''
    };
    const reference = reviewReference(pack);
    expect(reference.prompt).not.toContain('不能发送');
    expect(reference.excludedSources).toEqual(['.chaptale/memory/notes/猜测.md']);
    expect(reference.memoryRefs).toEqual(
      pack.sections
        .filter(section => !section.sourcePath.includes('/notes/'))
        .map(section => `${section.sourcePath}#${section.sourceHash}`)
    );
  });
});
