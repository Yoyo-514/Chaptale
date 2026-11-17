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

it('中文全文检索使用本会话候选并保留分页与分区，其他会话仍检索正式稿', async () => {
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
    entries: [{ workId, entryId: documentId, revisionId: pending()[0].version }],
    hasMore: false
  });
  expect((await call('work_search', { workId, query: '长安', offset: 1, limit: 1 })).result.structuredContent).toEqual({
    entries: [],
    hasMore: false
  });
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1, section: 'resource' })).result
      .structuredContent
  ).toEqual({ entries: [], hasMore: false });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toEqual({ entries: [], hasMore: false });
  expect(
    (await call('work_search', { workId, query: '将军', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toMatchObject({ entries: [{ entryId: documentId, revisionId }] });
});
