import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import {
  setupWorkSession,
  creation,
  host,
  workId,
  documentId,
  revisionId,
  value,
  call,
  pending
} from './work-session-fixture';

setupWorkSession();

it('按 glob 查找条目名称，包含候选改名及同名资料，并可限定分区', async () => {
  expect(
    (
      await call('work_write', {
        workId,
        parentId: null,
        title: '序章',
        section: 'resource',
        format: 'markdown',
        content: '人物资料'
      })
    ).isError
  ).toBe(false);
  const found = await call('work_find', { workId, pattern: '序?' });
  expect(found.isError).toBe(false);
  expect(found.result.structuredContent).toMatchObject([
    { workId, entryId: documentId, title: '序章', section: 'manuscript' },
    { title: '序章', section: 'resource' }
  ]);
  expect(
    (await call('work_mv', { workId, entryId: documentId, expectedRevisionId: revisionId, title: '第一章' })).isError
  ).toBe(false);
  const renamed = await call('work_find', { workId, pattern: '第*章', section: 'manuscript' });
  expect(renamed.result.structuredContent).toMatchObject([{ entryId: documentId, title: '第一章' }]);
  const absent = await call('work_find', { workId, pattern: '第*章', section: 'resource' });
  expect(absent.result.structuredContent).toEqual([]);
});

it('按资料类型查找规划资料', async () => {
  for (const [title, type] of [
    ['长夜大纲', '规划'],
    ['顾长风', '人物']
  ]) {
    const entry = value(
      creation.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section: 'resource',
          kind: 'document',
          title: title!,
          format: 'txt',
          content: ''
        }
      })
    );
    value(
      creation.executeAuthor({
        method: 'saveDocument',
        input: {
          commandId: randomUUID(),
          workId,
          documentId: entry.id,
          expectedRevisionId: entry.revisionId,
          title: title!,
          format: 'txt',
          content: '',
          attributes: { type: type!, aliases: [], tags: [], cover: null }
        }
      })
    );
  }
  const found = await call('work_find', { workId, pattern: '*', type: '规划' });
  expect(found.result.structuredContent).toMatchObject([{ title: '长夜大纲' }]);
  expect(found.result.structuredContent).toHaveLength(1);
});

it('按正则逐行查找本会话正文，返回行号和稳定身份，报告无效正则', async () => {
  expect(
    (
      await call('work_edit', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        oldText: '守城',
        newText: '出城'
      })
    ).isError
  ).toBe(false);
  const matches = await call('work_grep', { workId, pattern: '^将军(出城|巡营)' });
  expect(matches.isError).toBe(false);
  expect(matches.result.structuredContent).toEqual([
    { workId, entryId: documentId, revisionId: pending()[0].version, title: '序章', line: 1, text: '将军出城。' }
  ]);
  expect((await call('work_grep', { workId, pattern: '守城' })).result.structuredContent).toEqual([]);
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  const outside = await call('work_grep', { workId, pattern: '守城' }, randomUUID(), undefined, other);
  expect(outside.result.structuredContent).toMatchObject([{ entryId: documentId, text: '将军守城。' }]);
  const invalid = await call('work_grep', { workId, pattern: '[' });
  expect(invalid.isError).toBe(true);
  expect(invalid.result.structuredContent).toBeUndefined();
  expect(invalid.result.details).toMatchObject({
    ok: false,
    error: { code: 'invalid-request', message: '正则表达式无效' }
  });
});

it('检索使用本会话候选并保留分页与分区，其他会话仍检索正式稿', async () => {
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军前往长安。'
      })
    ).isError
  ).toBe(false);
  const found = await call('work_search', { workId, query: '长安', offset: 0, limit: 1, section: 'manuscript' });
  expect(found.isError).toBe(false);
  expect(found.result.structuredContent).toMatchObject({
    hits: [
      {
        kind: 'entry',
        entry: { workId, entryId: documentId, revisionId: pending()[0].version },
        pending: true,
        passages: [{ startLine: 1, endLine: 1, text: '将军前往长安。' }]
      }
    ],
    hasMore: false
  });
  expect((await call('work_search', { workId, query: '长安', offset: 1, limit: 1 })).result.structuredContent).toEqual({
    hits: [],
    hasMore: false
  });
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1, section: 'resource' })).result
      .structuredContent
  ).toEqual({ hits: [], hasMore: false });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toEqual({ hits: [], hasMore: false });
  expect(
    (await call('work_search', { workId, query: '将军', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toMatchObject({ hits: [{ kind: 'entry', entry: { entryId: documentId, revisionId }, pending: false }] });
});

it('检索返回段落、事件和关系，插图显示为占位，asOf 只到该章', async () => {
  const author = (title: string, section: 'manuscript' | 'resource', content: string) =>
    value(
      creation.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section,
          kind: 'document',
          title,
          format: 'markdown',
          content
        }
      })
    );
  const illustrated = author('彩页', 'manuscript', '开头。\n![城门](entry:img-1)\n将军出城。');
  const general = author('将军', 'resource', '');
  const scout = author('斥候', 'resource', '');
  const record = value(
    creation.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [general.id],
        text: '将军下令开城。',
        source: { kind: 'author' },
        placement: { kind: 'chapter', chapterId: illustrated.id },
        storyTime: ''
      }
    })
  );
  const relation = value(
    creation.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [general.id, scout.id],
        type: '上下级',
        directed: true,
        titles: ['主将', '部下'],
        milestones: [
          { id: null, kind: 'start', source: { kind: 'author' }, placement: { kind: 'opening' }, storyTime: '' }
        ]
      }
    })
  );

  const all = await call('work_search', { workId, query: '将军', offset: 0, limit: 10 });
  expect(all.isError).toBe(false);
  const { hits, hasMore } = all.result.structuredContent as { hits: Record<string, unknown>[]; hasMore: boolean };
  expect(hasMore).toBe(false);
  expect(hits).toHaveLength(5);
  expect(hits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'entry',
        entry: expect.objectContaining({ workId, entryId: documentId, revisionId }),
        ignoresAsOf: false,
        passages: [{ startLine: 1, endLine: 3, text: '将军守城。\n城外下雪。\n斥候回营。' }]
      }),
      expect.objectContaining({
        kind: 'entry',
        entry: expect.objectContaining({ entryId: illustrated.id, revisionId: illustrated.revisionId }),
        passages: [{ startLine: 1, endLine: 3, text: '开头。\n[插图：城门 entry:img-1]\n将军出城。' }]
      }),
      expect.objectContaining({ kind: 'entry', entry: expect.objectContaining({ entryId: general.id }), passages: [] }),
      {
        kind: 'record',
        matchedBy: 'keyword',
        record: expect.objectContaining({
          recordId: record.id,
          revisionId: record.revisionId,
          text: '将军下令开城。',
          placement: { kind: 'chapter', chapterId: illustrated.id },
          pending: false
        })
      },
      {
        kind: 'relation',
        matchedBy: 'keyword',
        relation: expect.objectContaining({
          relationId: relation.id,
          resourceIds: [general.id, scout.id],
          state: 'active',
          pending: false
        })
      }
    ])
  );

  // 序章是第一章：之后的彩页及发生在彩页的事件不返回，资料照常返回并标明不随进度。
  const early = await call('work_search', { workId, query: '将军', offset: 0, limit: 10, asOf: documentId });
  const earlyHits = (early.result.structuredContent as { hits: Record<string, unknown>[] }).hits;
  expect(earlyHits).toHaveLength(3);
  expect(earlyHits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'entry', entry: expect.objectContaining({ entryId: documentId }) }),
      expect.objectContaining({
        kind: 'entry',
        entry: expect.objectContaining({ entryId: general.id }),
        ignoresAsOf: true
      }),
      expect.objectContaining({ kind: 'relation' })
    ])
  );
  const invalid = await call('work_search', { workId, query: '将军', offset: 0, limit: 10, asOf: general.id });
  expect(invalid.isError).toBe(true);
  expect(invalid.result.details).toMatchObject({ ok: false, error: { message: '查看进度的章节不存在' } });
});
