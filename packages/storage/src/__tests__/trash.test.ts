import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

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
    expect(t.author('previewTrash', { workId: t.work.id, entryIds: [t.document.id] })).toEqual({
      entryCount: 1,
      pendingCount: 1
    });

    t.trash(t.document.id);

    expect(t.author('listPendingChanges', { workId: t.work.id, sessionId: null })).toEqual([]);
    const group = t.author<{ group: { id: string } } | null>('readCurrentDelivery', { sessionId: t.context.sessionId });
    const contents = t.author<{ entryId: string; decision: string }[]>('readDeliveryContents', {
      groupId: group!.group.id
    });
    expect(contents).toEqual([expect.objectContaining({ entryId: change.entryId, decision: 'deleted' })]);

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
