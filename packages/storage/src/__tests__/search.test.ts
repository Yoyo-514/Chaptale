import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Entry } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function application() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-search-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  return {
    rootDir,
    get app() {
      return app;
    },
    async reopen() {
      app.close();
      app = new CreationApplication(await openCreationStorage({ rootDir }));
    }
  };
}

function createWork(app: CreationApplication) {
  return value(
    app.executeAuthor({
      method: 'createWork',
      input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
    })
  );
}

function document(
  app: CreationApplication,
  workId: string,
  title: string,
  content: string,
  section: Entry['section'] = 'manuscript'
) {
  return value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section,
        kind: 'document',
        title,
        format: 'txt',
        content
      }
    })
  );
}

function search(app: CreationApplication, workId: string, query: string, offset = 0, limit = 10) {
  return value(app.executeAuthor({ method: 'searchDocuments', input: { workId, query, offset, limit } }));
}

it('中文全文检索匹配标题和正文，只返回指定作品的正式文稿及资料', async () => {
  const { app } = await application();
  const work = createWork(app);
  const other = createWork(app);
  const chapter = document(app, work.id, '雨夜', '城门外的将军正在等候。');
  const resource = document(app, work.id, '将军', '守城的人物资料。', 'resource');
  document(app, other.id, '将军', '属于另一部作品。');
  const page = search(app, work.id, '将军');
  expect(page.entries).toHaveLength(2);
  expect(page.entries.map(entry => entry.id)).toEqual(expect.arrayContaining([chapter.id, resource.id]));
  expect(page.hasMore).toBe(false);
  expect(page.entries.find(entry => entry.id === chapter.id)).toMatchObject({
    revisionId: chapter.revisionId,
    title: '雨夜'
  });
  expect(value(app.executeAuthor({ method: 'listWorks', input: {} }))).toHaveLength(2);
  expect(value(app.executeAuthor({ method: 'listEntries', input: { workId: work.id } }))).toHaveLength(2);
  expect(
    value(
      app.executeAuthor({
        method: 'searchDocuments',
        input: {
          workId: work.id,
          query: '将军',
          section: 'resource',
          offset: 0,
          limit: 10
        }
      })
    ).entries.map(entry => entry.id)
  ).toEqual([resource.id]);
});

it('正式保存与标题修改更新索引，恢复草稿不参与检索，重启后结果保留', async () => {
  const fixture = await application();
  const { app } = fixture;
  const work = createWork(app);
  const entry = document(app, work.id, '旧标题', '将军正在守城。');
  value(
    app.executeAuthor({
      method: 'writeDraft',
      input: {
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        draftId: randomUUID(),
        expectedDraftVersion: null,
        title: '旧标题',
        format: 'txt',
        content: '公主回城。'
      }
    })
  );
  expect(search(app, work.id, '公主').entries).toEqual([]);
  const saved = value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: '新标题',
        format: 'txt',
        content: '公主正在远行。'
      }
    })
  );
  expect(search(app, work.id, '将军').entries).toEqual([]);
  expect(search(app, work.id, '旧标题').entries).toEqual([]);
  expect(search(app, work.id, '公主').entries).toEqual([saved]);
  expect(search(app, work.id, '新标题').entries).toEqual([saved]);
  await fixture.reopen();
  expect(search(fixture.app, work.id, '公主').entries).toEqual([saved]);
  expect(
    value(fixture.app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: saved.id } }))
      .content
  ).toBe('公主正在远行。');
});

it('检索稳定分页，中英混合多词使用交集，标点和 MATCH 语法按字面处理', async () => {
  const { app } = await application();
  const work = createWork(app);
  const first = document(app, work.id, '夜行', 'Alice 在城门见到将军。');
  const second = document(app, work.id, '守城', 'Alice 与将军告别。');
  document(app, work.id, '清晨', 'Bob 在城门驻守。');
  const page1 = search(app, work.id, 'Alice 将军', 0, 1);
  const page2 = search(app, work.id, 'Alice 将军', 1, 1);
  expect(page1.hasMore).toBe(true);
  expect(page2.hasMore).toBe(false);
  expect(page1.entries).toHaveLength(1);
  expect(page2.entries).toHaveLength(1);
  expect(page1.entries[0]!.id).not.toBe(page2.entries[0]!.id);
  expect([...page1.entries, ...page2.entries].map(entry => entry.id)).toEqual(
    expect.arrayContaining([first.id, second.id])
  );
  expect(search(app, work.id, 'alice 将军').entries).toHaveLength(2);
  expect(search(app, work.id, '" : * ()').entries).toEqual([]);
  expect(search(app, work.id, 'Alice OR Bob').entries).toEqual([]);
  expect(search(app, work.id, '将军', 10, 1)).toEqual({ entries: [], hasMore: false });
});

it('回执写入失败时正文与索引一起回滚，同一命令重试只提交一次', async () => {
  const { app, rootDir } = await application();
  const work = createWork(app);
  const entry = document(app, work.id, '守城', '将军守城。');
  const input = {
    commandId: randomUUID(),
    workId: work.id,
    documentId: entry.id,
    expectedRevisionId: entry.revisionId,
    title: '守城',
    format: 'txt' as const,
    content: '公主远行。'
  };
  const fault = new Database(join(rootDir, 'works', work.id, 'work.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, '回执故障'); END"
    );
    expect(app.executeAuthor({ method: 'saveDocument', input })).toMatchObject({
      ok: false,
      error: { message: '回执故障' }
    });
    expect(search(app, work.id, '将军').entries).toEqual([entry]);
    expect(search(app, work.id, '公主').entries).toEqual([]);
    expect(
      value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: entry.id } })).content
    ).toBe('将军守城。');
    fault.exec('DROP TRIGGER fail_receipt');
    const saved = value(app.executeAuthor({ method: 'saveDocument', input }));
    expect(value(app.executeAuthor({ method: 'saveDocument', input }))).toEqual(saved);
    expect(search(app, work.id, '公主').entries).toEqual([saved]);
    expect(search(app, work.id, '将军').entries).toEqual([]);
  } finally {
    fault.close();
  }
});

it.each([
  { query: '', offset: 0, limit: 10 },
  { query: '  \n', offset: 0, limit: 10 },
  { query: '将军', offset: -1, limit: 10 },
  { query: '将军', offset: 0, limit: 0 },
  { query: '将军', offset: 0, limit: 1.5 },
  { query: '将军', offset: 0, limit: 10, section: 'other' }
])('搜索边界拒绝无效请求：%j', async input => {
  const { app } = await application();
  expect(app.executeAuthor({ method: 'searchDocuments', input: { workId: 'work', ...input } })).toMatchObject({
    ok: false,
    error: { code: 'invalid-request' }
  });
});
