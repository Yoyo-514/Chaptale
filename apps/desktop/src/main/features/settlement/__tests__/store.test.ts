import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChapterSettlement, SettlementBatch } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { AgentRunStore } from '../../runs/store';
import { WorkspaceService } from '../../workspace/service';
import { batchPath, chapterKey, hash, summaryPath } from '../files';
import { acceptanceContent, summaryContent } from '../proposals';
import { SettlementStore } from '../store';
import { rebuildRecent } from '../summaries';

let home: string;
let root: string;
let currentRoot: string;
let store: SettlementStore;
const chapterPath = '正文/第一章.md';
const characterPath = '角色/林晚.md';
const threadPath = '伏笔/来信.md';
const scenePath = '大纲/场景卡/夜访.md';
const chapter = '---\nid: chapter-one\nkind: chapter\ntitle: 初雪\norder: 1\n---\n林晚拆开来信。\n';
const character =
  '\uFEFF---\r\nid: character-one\r\nkind: character\r\ntitle: 林晚\r\ncustom: 0xFF # 保留\r\n---\r\n## 当前状态\r\n尚未拆信。\r\n\r\n其他细节不变。\n';
const thread = '---\nid: thread-one\nkind: plot-thread\ntitle: 来信\nstatus: planted\nadvances: []\n---\n信中秘密。\n';
const scene =
  '---\nkind: scene-card\ntitle: 夜访\nchapter: "[[正文/第一章.md]]"\nsettled: false\ncustom: [甲, 乙] # 保留\n---\n场景节拍。\n';
const output: ChapterSettlement = {
  summary: '林晚拆开来信，知道了约见地点。',
  updates: [
    {
      sourcePath: characterPath,
      reason: '本章已经拆信',
      edits: [{ original: '尚未拆信。', replacement: '已拆信，得知约见地点。', rationale: '正文事实' }]
    },
    {
      sourcePath: threadPath,
      reason: '秘密已揭示',
      thread: { status: 'resolved', advances: ['第一章：读到约见地点'] }
    }
  ],
  events: [{ title: '拆开来信', when: '', description: '林晚读到约见地点。', participants: ['[[角色/林晚.md]]'] }]
};
async function put(relativePath: string, content: string) {
  const filename = path.join(root, relativePath);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}
const text = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8');

async function create() {
  await put(chapterPath, chapter);
  await put(characterPath, character);
  await put(threadPath, thread);
  await put(scenePath, scene);
  const now = new Date().toISOString();
  const scenes = [{ sourcePath: scenePath, kind: 'scene-card', contentHash: hash(scene) }];
  const batch: SettlementBatch = {
    id: randomUUID(),
    revision: 1,
    status: 'generating',
    chapterPath,
    chapterKey: chapterKey(chapterPath, 'chapter-one'),
    chapterSourceId: 'chapter-one',
    chapterHash: hash(chapter),
    chapterTitle: '初雪',
    chapterOrder: 1,
    packId: 'saved-pack',
    personaId: 'chapter-distiller',
    model: { provider: 'fixture', modelId: 'saved-output' },
    autoAcceptSummary: false,
    worldDirectory: '设定',
    sources: [
      { sourcePath: characterPath, kind: 'character', contentHash: hash(character) },
      { sourcePath: threadPath, kind: 'plot-thread', contentHash: hash(thread) },
      ...scenes
    ],
    scenes,
    items: [],
    createdAt: now,
    updatedAt: now
  };
  await store.create(root, batch);
  return batch;
}
async function finish(batch: SettlementBatch, result: unknown = output) {
  const runId = randomUUID();
  const outputRef = await new AgentRunStore({ resolveCwd: () => root }).saveOutput(
    runId,
    `<output>${JSON.stringify(result)}</output>`
  );
  await store.finish(root, batch.id, { output: result, runId, outputRef });
  return store.read(root, batch.id);
}
async function decide(batchId: string, itemId: string, action: 'accept' | 'reject', editedContent?: string) {
  const batch = await store.read(root, batchId);
  return store.resolve({
    rootPath: root,
    batchId,
    revision: batch.revision,
    itemId,
    action,
    ...(editedContent === undefined ? {} : { editedContent })
  });
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settlement-'));
  root = path.join(home, 'book');
  currentRoot = root;
  await mkdir(root);
  store = new SettlementStore(
    new WorkspaceService({
      getStorageContext: async () => ({ workspacePath: currentRoot })
    })
  );
});
afterEach(async () => {
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home).startsWith('chaptale-settlement-')).toBe(true);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('章节结算文件确认链路', () => {
  it('生成不写事实，逐项确认保留未触及字节，完成后才标记场景', async () => {
    const batch = await finish(await create());
    expect(batch.items).toHaveLength(4);
    expect(await text(characterPath)).toBe(character);
    expect(await text(scenePath)).toBe(scene);
    await expect(text(summaryPath(batch.chapterKey))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.complete({ rootPath: root, batchId: batch.id, revision: batch.revision })).rejects.toThrow(
      '先处理'
    );
    await decide(batch.id, 'asset-0', 'accept');
    expect(await text(characterPath)).toBe(character.replace('尚未拆信。', '已拆信，得知约见地点。'));
    await decide(batch.id, 'asset-1', 'accept');
    expect(parseDocumentFrontmatter(await text(threadPath))).toMatchObject({
      frontmatter: { status: 'resolved', advances: ['第一章：读到约见地点'] }
    });
    const proposed = batch.items.find(item => item.id === 'summary')!.proposedContent;
    await decide(batch.id, 'summary', 'accept', proposed.replace('知道了约见地点', '确认了桥下约见'));
    expect(await text(summaryPath(batch.chapterKey))).toContain('确认了桥下约见');
    expect(await text('.chaptale/memory/summaries/recent.md')).toContain('确认了桥下约见');
    const rejected = await decide(batch.id, 'event-0', 'reject');
    await expect(text(batch.items.find(item => item.id === 'event-0')!.targetPath)).rejects.toMatchObject({
      code: 'ENOENT'
    });
    const completed = await store.complete({ rootPath: root, batchId: batch.id, revision: rejected.batch.revision });
    expect(completed.batch.status).toBe('completed');
    expect(await text(scenePath)).toBe(patchDocumentFields(scene, { settled: true }));
    expect(await text(chapterPath)).toBe(chapter);
    expect(await store.complete({ rootPath: root, batchId: batch.id, revision: 1 })).toMatchObject({
      batch: { status: 'completed' }
    });
  });

  it('时间线只新建指定落点，不覆盖同名现有文件', async () => {
    const batch = await finish(await create());
    const event = batch.items.find(item => item.category === 'timeline')!;
    await put(event.targetPath, '作者文件');
    await expect(decide(batch.id, event.id, 'accept')).rejects.toThrow('资产已变化');
    await decide(batch.id, event.id, 'reject');
    expect(await text(event.targetPath)).toBe('作者文件');
    const next = await finish(await create());
    const accepted = await decide(next.id, 'event-0', 'accept');
    expect(await text(accepted.batch.items.find(item => item.id === 'event-0')!.targetPath)).toContain(
      '林晚读到约见地点'
    );
  });

  it('资产冲突不留下接受意图，仍可拒绝，正文变化也阻止接受', async () => {
    const batch = await finish(await create());
    await put(characterPath, '外部新状态');
    await expect(decide(batch.id, 'asset-0', 'accept')).rejects.toThrow('资产已变化');
    expect((await store.read(root, batch.id)).items.find(item => item.id === 'asset-0')?.applying).toBeUndefined();
    expect((await decide(batch.id, 'asset-0', 'reject')).batch.items[1]?.status).toBe('rejected');
    await put(chapterPath, '新的正文');
    await expect(decide(batch.id, 'summary', 'accept')).rejects.toThrow('正文已变化');
    expect((await store.details(root, batch.id)).stale).toBe(true);
    expect(await text(characterPath)).toBe('外部新状态');
  });

  it('晚到输出、未知目标、元数据替换和非唯一锚点均不能形成可接受提议', async () => {
    const batch = await create();
    await put(chapterPath, '新正文');
    await expect(finish(batch)).rejects.toThrow('正文已变化');
    await put(chapterPath, chapter);
    await expect(
      finish(batch, { ...output, updates: [{ ...output.updates[0], sourcePath: '角色/未提供.md' }] })
    ).rejects.toThrow('参考中的');
    await expect(
      finish(batch, {
        ...output,
        updates: [
          {
            ...output.updates[0],
            edits: [{ original: 'kind: character', replacement: 'kind: world', rationale: '无效' }]
          }
        ]
      })
    ).rejects.toThrow();
    await expect(
      finish(batch, {
        ...output,
        updates: [{ ...output.updates[0], edits: [{ original: '。', replacement: '!', rationale: '非唯一' }] }]
      })
    ).rejects.toThrow();
    expect(await text(characterPath)).toBe(character);
  });

  it('绑定实际留档内容，并拒绝后续修改原始输出', async () => {
    const batch = await create();
    const runId = randomUUID();
    const outputRef = await new AgentRunStore({ resolveCwd: () => root }).saveOutput(
      runId,
      `<output>${JSON.stringify(output)}</output>`
    );
    await expect(
      store.finish(root, batch.id, { output: { ...output, summary: '不是留档内容' }, runId, outputRef })
    ).rejects.toThrow('留档不一致');
    await store.finish(root, batch.id, { output, runId, outputRef });
    await put(outputRef, JSON.stringify({ runId, rawText: '被修改' }));
    await expect(store.read(root, batch.id)).rejects.toThrow('原始输出已被修改');
    expect((await store.list(root)).diagnostics).toHaveLength(1);
  });

  it.each(['before', 'after', 'other'] as const)('恢复接受意图时按真实磁盘状态处理：%s', async state => {
    const batch = await finish(await create());
    const item = batch.items.find(value => value.id === 'asset-0')!;
    const at = new Date().toISOString();
    const content = acceptanceContent(batch, item, undefined, at);
    item.applying = { content, contentHash: hash(content), at };
    await put(batchPath(batch.id), JSON.stringify(batch));
    await put(characterPath, state === 'before' ? character : state === 'after' ? content : '外部覆盖');
    if (state === 'other') {
      await expect(decide(batch.id, item.id, 'accept')).rejects.toThrow('资产已变化');
      await decide(batch.id, item.id, 'reject');
      expect(await text(characterPath)).toBe('外部覆盖');
    } else {
      if (state === 'after') await put(chapterPath, '正文随后变化');
      const resolved = await decide(batch.id, item.id, 'accept');
      expect(resolved.batch.items.find(value => value.id === item.id)).toMatchObject({
        status: 'accepted',
        acceptedHash: hash(content)
      });
      expect(await text(characterPath)).toBe(content);
      await expect(decide(batch.id, item.id, 'accept')).rejects.toThrow('已经处理');
    }
  });

  it('损坏接受意图不能用自洽 hash 绕过原提议', async () => {
    const batch = await finish(await create());
    const item = batch.items.find(value => value.id === 'asset-0')!;
    item.applying = { content: '未经展示的内容', contentHash: hash('未经展示的内容'), at: new Date().toISOString() };
    await put(batchPath(batch.id), JSON.stringify(batch));
    await expect(decide(batch.id, item.id, 'accept')).rejects.toThrow('意图损坏');
    expect(await text(characterPath)).toBe(character);
  });

  it('场景完成意图只允许改变 settled，支持写入后重启恢复', async () => {
    const initial = await finish(await create());
    for (const item of initial.items) await decide(initial.id, item.id, 'reject');
    const batch = await store.read(root, initial.id);
    const content = patchDocumentFields(scene, { settled: true });
    batch.completing = [
      { sourcePath: scenePath, beforeContent: scene, beforeHash: hash(scene), afterHash: hash(content), content }
    ];
    await put(batchPath(batch.id), JSON.stringify(batch));
    await put(scenePath, content);
    expect((await store.complete({ rootPath: root, batchId: batch.id, revision: batch.revision })).batch.status).toBe(
      'completed'
    );
    batch.completing[0]!.content = content.replace('场景节拍', '未经确认的修改');
    batch.completing[0]!.afterHash = hash(batch.completing[0]!.content);
    await put(batchPath(batch.id), JSON.stringify(batch));
    await expect(store.read(root, batch.id)).rejects.toThrow('场景意图损坏');
  });

  it('拒绝元数据破坏、越界目标、内部目录链接、旧 revision 和作品切换', async () => {
    const batch = await finish(await create());
    const item = batch.items.find(value => value.id === 'asset-0')!;
    await expect(
      decide(batch.id, item.id, 'accept', item.proposedContent.replace('id: character-one', 'id: changed'))
    ).rejects.toThrow('不能改变 id');
    await expect(
      store.resolve({ rootPath: root, batchId: batch.id, itemId: item.id, action: 'accept', revision: 999 })
    ).rejects.toThrow('状态已变化');
    await mkdir(path.join(root, '.chaptale/hidden'), { recursive: true });
    await put('.chaptale/hidden/林晚.md', character);
    await symlink(path.join(root, '.chaptale/hidden'), path.join(root, '链接'), 'junction');
    batch.sources.push({ sourcePath: '链接/林晚.md', kind: 'character', contentHash: hash(character) });
    item.targetPath = '链接/林晚.md';
    await put(batchPath(batch.id), JSON.stringify(batch));
    await expect(decide(batch.id, item.id, 'accept')).rejects.toThrow('链接');
    expect(await text('.chaptale/hidden/林晚.md')).toBe(character);
    item.targetPath = '../outside.md';
    await put(batchPath(batch.id), JSON.stringify(batch));
    await expect(store.read(root, batch.id)).rejects.toThrow('损坏');
    currentRoot = home;
    await expect(store.list(root)).rejects.toThrow('作品已经切换');
  });
});

describe('最近三章摘要', () => {
  it.each([true, false])('确定性选择最近三章，明确章序优先：%s', async ordered => {
    const batch = await create();
    for (let index = 1; index <= 4; index++) {
      const copy = {
        ...batch,
        id: `batch-${index}`,
        chapterTitle: `章节${index}`,
        chapterKey: chapterKey(`正文/${index}.md`),
        chapterPath: `正文/${index}.md`,
        chapterOrder: ordered ? 5 - index : undefined
      };
      await put(summaryPath(copy.chapterKey), summaryContent(copy, `事实${index}`, `2026-09-0${index}T00:00:00.000Z`));
    }
    await rebuildRecent(root);
    const first = await text('.chaptale/memory/summaries/recent.md');
    expect(first).not.toContain(ordered ? '事实4' : '事实1');
    expect(first).toContain(ordered ? '事实1' : '事实4');
    await rebuildRecent(root);
    expect(await text('.chaptale/memory/summaries/recent.md')).toBe(first);
  });
});
