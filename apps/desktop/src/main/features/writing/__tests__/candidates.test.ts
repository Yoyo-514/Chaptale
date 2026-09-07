import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { normalizeDocumentText, type Candidate } from '@chaptale/shared';

import { assertTaskInputBudget } from '../../tasks/session';
import { readDocumentSnapshot } from '../../workspace/read-document';
import { WorkspaceService } from '../../workspace/service';
import { CandidateStore } from '../candidates';
import { VersionStore } from '../versions';

let home: string;
let root: string;
let currentRoot: string;
let store: CandidateStore;
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const before = '\uFEFF第一段。\r\n' + '中间保持原样。\r\n'.repeat(20) + '最后一段。\n';
const after = before.replace('第一段', '全新首段').replace('最后一段', '全新尾段');
async function create(content = before) {
  await writeFile(path.join(root, 'chapter.md'), content);
  const candidate: Candidate = {
    id: randomUUID(),
    revision: 1,
    status: 'generating',
    targetPath: 'chapter.md',
    baselineContent: content,
    baselineHash: hash(content),
    proposedContent: content,
    range: { from: 0, to: normalizeDocumentText(content).length },
    goal: '测试留档',
    packId: 'pack-1',
    personaId: 'draft',
    model: { provider: 'fixture', modelId: 'saved-output' },
    usedStalePack: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acceptances: []
  };
  await store.create(root, candidate);
  return candidate;
}
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-candidates-'));
  root = path.join(home, 'book');
  currentRoot = root;
  await mkdir(root);
  store = new CandidateStore(
    new WorkspaceService({
      getStorageContext: async () => ({ storageMode: 'workspace', workspacePath: currentRoot })
    })
  );
});
afterEach(async () => {
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home).startsWith('chaptale-candidates-')).toBe(true);
  await rm(home, { recursive: true, force: true });
});

describe('候选文件事务', () => {
  it('创建与生成不改正文，部分接受后重算，全部接受持久化状态和原版本', async () => {
    const candidate = await create();
    const ready = await store.finish(
      root,
      candidate.id,
      normalizeDocumentText(after),
      'run-1',
      '.chaptale/runs/outputs/run-1.json'
    );
    expect(await readFile(path.join(root, 'chapter.md'), 'utf8')).toBe(before);
    expect(ready.changes.length).toBeGreaterThan(1);
    const first = await store.apply({
      rootPath: root,
      candidateId: candidate.id,
      revision: ready.candidate.revision,
      changeIndexes: [0]
    });
    expect(first.details.candidate.status).toBe('partially-accepted');
    expect(first.document.content.startsWith('\uFEFF全新首段。\r\n')).toBe(true);
    expect(first.document.content.endsWith('最后一段。\n')).toBe(true);
    const final = await store.apply({
      rootPath: root,
      candidateId: candidate.id,
      revision: first.details.candidate.revision,
      changeIndexes: first.details.changes.map((_, index) => index)
    });
    expect(final.details.candidate.status).toBe('accepted');
    expect(final.details.candidate.acceptances).toHaveLength(2);
    expect((await store.read(root, candidate.id)).candidate.status).toBe('accepted');
    const versions = await store.versions.list(root, 'chapter.md');
    expect(versions).toHaveLength(2);
    expect((await store.versions.read(root, 'chapter.md', versions[1]!.id)).content).toBe(before);
  });
  it('拒绝旧 revision、无效块和重复接受', async () => {
    const candidate = await create('原文');
    const ready = await store.finish(root, candidate.id, '修改', 'run-1', '.chaptale/runs/outputs/run-1.json');
    const args = { rootPath: root, candidateId: candidate.id, revision: ready.candidate.revision, changeIndexes: [0] };
    await expect(store.apply({ ...args, revision: 1 })).rejects.toThrow('状态已更新');
    await expect(store.apply({ ...args, changeIndexes: [999] })).rejects.toThrow('选择无效');
    await store.apply(args);
    await expect(store.apply(args)).rejects.toThrow('不可接受');
  });
  it('正文改变后转 stale，不能接受，放弃也不改正文', async () => {
    const candidate = await create();
    await store.finish(root, candidate.id, '新稿', 'run-1', '.chaptale/runs/outputs/run-1.json');
    await writeFile(path.join(root, 'chapter.md'), '外部修改');
    const stale = await store.read(root, candidate.id);
    expect(stale.candidate.status).toBe('stale');
    await expect(
      store.apply({ rootPath: root, candidateId: candidate.id, revision: stale.candidate.revision, changeIndexes: [0] })
    ).rejects.toThrow();
    await store.setStatus(root, candidate.id, 'discarded');
    expect(await readFile(path.join(root, 'chapter.md'), 'utf8')).toBe('外部修改');
  });
  it('切换工作区不误标启动时的候选，但禁止写入旧工作区', async () => {
    const candidate = await create('原文');
    currentRoot = home;
    const ready = await store.finish(root, candidate.id, '新稿', 'run-1', '.chaptale/runs/outputs/run-1.json');
    expect(ready.candidate.status).toBe('ready');
    await expect(
      store.apply({ rootPath: root, candidateId: candidate.id, revision: ready.candidate.revision, changeIndexes: [0] })
    ).rejects.toThrow();
    expect(await readFile(path.join(root, 'chapter.md'), 'utf8')).toBe('原文');
  });
  it.each(['before', 'after', 'other'])('重启按磁盘内容恢复接受意图：%s', async diskState => {
    const candidate = await create('原文');
    const ready = await store.finish(root, candidate.id, '新稿', 'run-1', '.chaptale/runs/outputs/run-1.json');
    const record = {
      ...ready.candidate,
      applying: { content: '新稿', afterHash: hash('新稿'), changes: 1, at: new Date().toISOString() }
    };
    await writeFile(path.join(root, `.chaptale/revisions/candidates/${candidate.id}.json`), JSON.stringify(record));
    await writeFile(
      path.join(root, 'chapter.md'),
      diskState === 'before' ? '原文' : diskState === 'after' ? '新稿' : '外部改动'
    );
    const recovered = await store.read(root, candidate.id);
    expect(recovered.candidate.status).toBe(
      diskState === 'before' ? 'ready' : diskState === 'after' ? 'accepted' : 'stale'
    );
    expect(recovered.candidate.applying).toBeUndefined();
    expect((await store.read(root, candidate.id)).candidate.acceptances).toHaveLength(diskState === 'after' ? 1 : 0);
  });
  it('空输出、内部目标和损坏 hash 失败，原始文件保留', async () => {
    const candidate = await create();
    await expect(store.finish(root, candidate.id, ' ', 'run-1', '.chaptale/runs/outputs/run-1.json')).rejects.toThrow(
      '为空'
    );
    await expect(
      store.create(root, { ...candidate, id: randomUUID(), targetPath: '.chaptale/secret.md' })
    ).rejects.toThrow('内部');
    await expect(store.create(root, { ...candidate, id: randomUUID(), baselineHash: hash('other') })).rejects.toThrow(
      '校验失败'
    );
    expect(await readFile(path.join(root, 'chapter.md'), 'utf8')).toBe(before);
  });
  it('版本保留最近20个非定稿和所有定稿，篡改快照不可使用', async () => {
    await create('原文');
    const versions = new VersionStore();
    const document = await readDocumentSnapshot({ rootPath: root, relativePath: 'chapter.md' });
    const final = await versions.save(document, 'final');
    for (let i = 0; i < 23; i++) await versions.save(document, 'accepted');
    const snapshots = await versions.list(root, 'chapter.md');
    expect(snapshots).toHaveLength(21);
    expect(snapshots.some(snapshot => snapshot.id === final.id)).toBe(true);
    await writeFile(path.join(root, final.contentPath), '篡改');
    await expect(versions.read(root, 'chapter.md', final.id)).rejects.toThrow('已被外部修改');
  });
  it('硬预算包含系统与完整输入，超限失败不截断', () => {
    expect(() => assertTaskInputBudget('正文', { contextWindow: 1000, maxTokens: 100 })).not.toThrow();
    expect(() => assertTaskInputBudget('文'.repeat(1000), { contextWindow: 1000, maxTokens: 100 })).toThrow('未截断');
  });
});
