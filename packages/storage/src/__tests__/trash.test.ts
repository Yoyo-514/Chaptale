import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';
import type { CreationResult, Entry } from '@chaptale/creation/contracts';

import { application, value } from './fixtures/review.ts';

async function setup() {
  const fixture = await application();
  const { work } = fixture;
  const author = <T>(method: string, input: object): T =>
    value(fixture.app.executeAuthor({ method, input } as never) as CreationResult<T>);
  const create = (title: string, parentId: string | null, kind: 'directory' | 'document' = 'document'): Entry =>
    author('createEntry', {
      commandId: randomUUID(),
      workId: work.id,
      parentId,
      section: 'manuscript',
      kind,
      title,
      ...(kind === 'document' ? { format: 'txt', content: `${title}的正文` } : {})
    });
  const titles = (parentId: string | null) =>
    author<Entry[]>('listEntries', { workId: work.id })
      .filter(entry => entry.parentId === parentId)
      .reduce<string[]>((ordered, entry) => {
        ordered[entry.position] = entry.title;
        return ordered;
      }, []);
  const trash = (...entryIds: string[]): Entry[] =>
    author('trashEntries', { commandId: randomUUID(), workId: work.id, entryIds });
  const batches = () => author<{ id: string; roots: Entry[]; entryCount: number }[]>('listTrash', { workId: work.id });
  const restore = (batchId: string): Entry[] =>
    author('restoreTrash', { commandId: randomUUID(), workId: work.id, batchId });
  const purge = (batchId: string | null): Entry[] =>
    author('purgeTrash', { commandId: randomUUID(), workId: work.id, batchId });
  return { ...fixture, author, create, titles, trash, batches, restore, purge };
}

describe('作品回收站', () => {
  it('删除目录时子项随同一批次进入回收站，正常目录、读取与检索都排除', async () => {
    const t = await setup();
    const volume = t.create('第一卷', null, 'directory');
    const chapter = t.create('雪夜', volume.id);

    expect(t.trash(volume.id).map(entry => entry.id)).toEqual(expect.arrayContaining([volume.id, chapter.id]));

    expect(t.titles(null)).toEqual(['序章']);
    expect(t.batches()).toEqual([
      expect.objectContaining({ entryCount: 2, roots: [expect.objectContaining({ id: volume.id })] })
    ]);
    const read = t.app.executeAuthor({ method: 'readDocument', input: { workId: t.work.id, documentId: chapter.id } });
    expect(read).toMatchObject({ ok: false, error: { message: '条目在回收站中' } });
    const found = t.author('searchDocuments', { workId: t.work.id, query: '雪夜', limit: 10, offset: 0 });
    expect(found).toEqual({ entries: [], hasMore: false });
    expect(t.author('readTrashedDocument', { workId: t.work.id, documentId: chapter.id })).toMatchObject({
      content: '雪夜的正文'
    });
  });

  it('恢复回到原序号并重新纳入检索；超出同级数量时排到最后', async () => {
    const t = await setup();
    const second = t.create('第二章', null);
    t.create('第三章', null);
    t.trash(second.id);
    expect(t.titles(null)).toEqual(['序章', '第三章']);

    t.restore(t.batches()[0]!.id);

    expect(t.titles(null)).toEqual(['序章', '第二章', '第三章']);
    expect(t.batches()).toEqual([]);
    const found = t.author('searchDocuments', { workId: t.work.id, query: '第二章', limit: 10, offset: 0 });
    expect(found).toMatchObject({ entries: [expect.objectContaining({ id: second.id })] });

    const last = t.create('第四章', null);
    t.trash(last.id);
    t.trash(second.id);
    t.restore(t.batches().find(batch => batch.roots[0]!.id === last.id)!.id);
    expect(t.titles(null)).toEqual(['序章', '第三章', '第四章']);
  });

  it('原父目录也在回收站时，只连同上方目录本身恢复', async () => {
    const t = await setup();
    const volume = t.create('第一卷', null, 'directory');
    const kept = t.create('留下', volume.id);
    const other = t.create('另一章', volume.id);
    t.trash(kept.id);
    t.trash(volume.id);

    const keptBatch = t.batches().find(batch => batch.roots[0]!.id === kept.id)!;
    t.restore(keptBatch.id);

    expect(t.titles(null)).toEqual(['序章', '第一卷']);
    expect(t.titles(volume.id)).toEqual(['留下']);
    expect(t.batches()).toEqual([expect.objectContaining({ roots: [expect.objectContaining({ id: other.id })] })]);
  });

  it('永久清空删除条目与修订；原父目录已清空的条目恢复到根层级末尾', async () => {
    const t = await setup();
    const volume = t.create('第一卷', null, 'directory');
    const kept = t.create('留下', volume.id);
    t.trash(kept.id);
    t.trash(volume.id);
    const volumeBatch = t.batches().find(batch => batch.roots[0]!.id === volume.id)!;

    expect(t.purge(volumeBatch.id).map(entry => entry.id)).toEqual([volume.id]);
    const revision = t.app.executeAuthor({
      method: 'readRevision',
      input: { workId: t.work.id, revisionId: volume.revisionId }
    });
    expect(revision).toMatchObject({ ok: false });

    t.restore(t.batches()[0]!.id);
    expect(t.titles(null)).toEqual(['序章', '留下']);

    t.trash(kept.id);
    expect(t.purge(null)).toHaveLength(1);
    expect(t.batches()).toEqual([]);
  });

  it('删除时一并拒绝指向这些条目的待审修改，续跑结果标为作者已删除', async () => {
    const t = await setup();
    const change = t.propose('Agent 改写的序章');
    expect(t.author('previewTrash', { workId: t.work.id, entryIds: [t.document.id] })).toMatchObject({
      entryCount: 1,
      pendingCount: 1
    });

    t.trash(t.document.id);

    expect(t.author('listPendingChanges', { workId: t.work.id, sessionId: null })).toEqual([]);
    const group = t.author<{ group: { id: string } } | null>('readCurrentDelivery', { sessionId: t.context.sessionId });
    const contents = t.author<{ entryId: string; decision: string }[]>('readDeliveryContents', {
      groupId: group!.group.id
    });
    expect(contents).toEqual([expect.objectContaining({ targetId: change.targetId, decision: 'deleted' })]);

    t.restore(t.batches()[0]!.id);
    expect(t.author('listPendingChanges', { workId: t.work.id, sessionId: null })).toEqual([]);
  });

  it('重试相同删除命令沿用回执，不重复删除', async () => {
    const t = await setup();
    const second = t.create('第二章', null);
    const commandId = randomUUID();
    const input = { commandId, workId: t.work.id, entryIds: [second.id] };
    const first = t.author('trashEntries', input);
    await t.reopen();
    expect(t.author('trashEntries', input)).toEqual(first);
    expect(t.batches()).toHaveLength(1);
  });
});

type Fixture = Awaited<ReturnType<typeof setup>>;
const remove = (t: Fixture, mode: 'review' | 'direct', entryId: string, revisionId: string) =>
  t.app.executeAgent(
    { sessionId: t.context.sessionId, mode },
    {
      method: 'deleteEntry',
      input: { commandId: randomUUID(), workId: t.work.id, entryId, expectedRevisionId: revisionId }
    }
  );
const pending = (t: Fixture) =>
  t.author<{ id: string; targetId: string; status: string }[]>('listPendingChanges', {
    workId: t.work.id,
    sessionId: null
  });
const decide = (t: Fixture, changeId: string, decision: 'accept' | 'reject') => {
  const view = t.author<{
    change: { id: string; version: string };
    current: { revisionId: string; parentId: string | null; position: number } | null;
  }>('readReview', { changeId });
  return t.author('decideReview', {
    commandId: randomUUID(),
    changeId,
    expectedVersion: view.change.version,
    expectedRevisionId: view.current?.revisionId ?? null,
    expectedLocation: view.current ? { parentId: view.current.parentId, position: view.current.position } : null,
    decision
  });
};

describe('Agent 删除', () => {
  it('直接修改模式立即移入回收站', async () => {
    const t = await setup();
    const result = value(remove(t, 'direct', t.document.id, t.document.revisionId));
    expect(result).toMatchObject({ kind: 'trashed', entries: [expect.objectContaining({ id: t.document.id })] });
    expect(t.batches()).toHaveLength(1);
  });

  it('审阅模式生成删除候选，会话目录隐藏目标；接受后移入回收站', async () => {
    const t = await setup();
    const result = value(remove(t, 'review', t.document.id, t.document.revisionId));
    if (result.kind !== 'pending') throw new Error('预期删除候选');
    expect(result.change.deleted).toBe(true);
    expect(t.titles(null)).toEqual(['序章']);
    const session = value(t.app.executeAgent(t.context, { method: 'listEntries', input: { workId: t.work.id } }));
    expect(session).toEqual([]);
    const search = (mode: 'review' | 'direct') =>
      value(
        t.app.executeAgent(
          { sessionId: t.context.sessionId, mode },
          { method: 'searchDocuments', input: { workId: t.work.id, query: '序章', offset: 0, limit: 10 } }
        )
      ).entries.map(entry => entry.id);
    expect(search('review')).toEqual([]);
    expect(search('direct')).toEqual([t.document.id]);

    decide(t, result.change.id, 'accept');
    expect(t.titles(null)).toEqual([]);
    expect(t.batches()).toHaveLength(1);
  });

  it('删除目录时并入其中的本会话修改；拒绝删除后恢复待审，接受删除后一并拒绝', async () => {
    const t = await setup();
    const volume = t.create('第一卷', null, 'directory');
    const chapter = t.create('雪夜', volume.id);
    const edit = value(
      t.app.executeAgent(t.context, {
        method: 'writeContent',
        input: {
          commandId: randomUUID(),
          workId: t.work.id,
          documentId: chapter.id,
          expectedRevisionId: chapter.revisionId,
          content: '改写'
        }
      })
    );
    if (edit.kind !== 'pending') throw new Error('预期待审修改');
    const removal = value(remove(t, 'review', volume.id, volume.revisionId));
    if (removal.kind !== 'pending') throw new Error('预期删除候选');
    expect(pending(t).map(item => item.id)).toEqual([removal.change.id]);

    decide(t, removal.change.id, 'reject');
    expect(pending(t).map(item => item.id)).toEqual([edit.change.id]);

    const again = value(remove(t, 'review', volume.id, volume.revisionId));
    if (again.kind !== 'pending') throw new Error('预期删除候选');
    decide(t, again.change.id, 'accept');
    expect(pending(t)).toEqual([]);
    expect(t.author<{ change: { status: string } }>('readReview', { changeId: edit.change.id }).change).toMatchObject({
      status: 'rejected'
    });
  });

  it('删除本会话未接受的新建条目时撤回候选，不计入续跑结果', async () => {
    const t = await setup();
    const created = value(
      t.app.executeAgent(t.context, {
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: t.work.id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title: '新章',
          format: 'txt',
          content: '新内容'
        }
      })
    );
    if (created.kind !== 'pending') throw new Error('预期新建候选');
    t.propose('Agent 改写的序章');
    const result = value(
      remove(t, 'review', created.change.targetId, (created.change.candidate as EntrySnapshot).revisionId)
    );
    expect(result.kind).toBe('withdrawn');
    expect(pending(t).map(item => item.targetId)).toEqual([t.document.id]);
    expect(t.batches()).toEqual([]);
    const group = t.author<{ group: { changeIds: string[] } }>('readCurrentDelivery', {
      sessionId: t.context.sessionId
    });
    expect(group.group.changeIds).not.toContain(created.change.id);
  });
});

const command = (t: Fixture, method: string) => t.author(method, { commandId: randomUUID(), workId: t.work.id });
const ids = (items: { id: string }[]) => items.map(item => item.id);

describe('作品库回收站', () => {
  it('删除作品时移出作品库并拒绝待审修改，会话归属保留；恢复后待审修改不再恢复', async () => {
    const t = await setup();
    t.author('assignSession', { sessionId: t.context.sessionId, workId: t.work.id });
    const change = t.propose('Agent 改写');
    expect(t.author('previewTrashWork', { workId: t.work.id })).toEqual({ pendingCount: 1 });

    command(t, 'trashWork');

    expect(ids(t.author('listWorks', {}))).toEqual([]);
    expect(ids(t.author('listTrashedWorks', {}))).toEqual([t.work.id]);
    expect(t.author<{ change: { status: string } }>('readReview', { changeId: change.id }).change.status).toBe(
      'rejected'
    );
    const agent = t.app.executeAgent(t.context, { method: 'listEntries', input: { workId: t.work.id } });
    expect(agent).toMatchObject({ ok: false, error: { message: '作品不存在' } });
    expect(t.author<{ assignments: unknown[] }>('readSessionState', {}).assignments).toEqual([
      { sessionId: t.context.sessionId, workId: t.work.id }
    ]);

    command(t, 'restoreWork');
    expect(ids(t.author('listWorks', {}))).toEqual([t.work.id]);
    expect(t.author('listPendingChanges', { workId: t.work.id, sessionId: null })).toEqual([]);
  });

  it('永久清空作品时返回作品目录，会话转为未归属，交付组不再引用该作品的修改', async () => {
    const t = await setup();
    t.author('assignSession', { sessionId: t.context.sessionId, workId: t.work.id });
    t.propose('Agent 改写');
    const group = t.author<{ group: { id: string } }>('readCurrentDelivery', { sessionId: t.context.sessionId }).group;
    command(t, 'trashWork');

    const { files } = command(t, 'purgeWork') as { files: string[] };

    expect(files.map(file => basename(file))).toEqual([t.work.id]);
    expect(existsSync(join(files[0]!, 'work.sqlite'))).toBe(true);
    expect(t.author('listTrashedWorks', {})).toEqual([]);
    expect(t.author<{ assignments: unknown[] }>('readSessionState', {}).assignments).toEqual([]);
    expect(t.author('readDeliveryContents', { groupId: group.id })).toEqual([]);
  });
});
