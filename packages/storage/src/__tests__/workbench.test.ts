import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationService } from '@chaptale/creation';

import { openCreationStorage } from '../index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-workbench-'));
  const service = new CreationService(await openCreationStorage({ rootDir }));
  const library = new Database(path.join(rootDir, 'library.sqlite'));
  cleanups.push(async () => {
    library.close();
    service.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
  const entry = service.createEntry({
    commandId: randomUUID(),
    workId: work.id,
    parentId: null,
    section: 'manuscript',
    kind: 'document',
    title: '雨夜',
    format: 'txt',
    content: '原稿'
  });
  return { rootDir, service, library, work, entry };
}

it('正文保存更新作品列表时间，重试和同内容保存保留该时间', async () => {
  const { service, library, work, entry } = await setup();
  // 固定旧目录时间，使快速运行的测试也能识别漏写作品索引。
  library.prepare('UPDATE works SET updatedAt = 1 WHERE id = ?').run(work.id);
  const input = {
    commandId: randomUUID(),
    workId: work.id,
    documentId: entry.id,
    expectedRevisionId: entry.revisionId,
    title: '雨夜',
    format: 'txt' as const,
    content: '雨停了'
  };
  const saved = service.saveDocument(input);
  expect(service.listWorks()[0]?.updatedAt).toBe(saved.updatedAt);
  expect(service.saveDocument(input)).toEqual(saved);
  const unchanged = service.saveDocument({ ...input, commandId: randomUUID(), expectedRevisionId: saved.revisionId });
  expect(unchanged.revisionId).toBe(saved.revisionId);
  expect(service.listWorks()[0]?.updatedAt).toBe(saved.updatedAt);
});

it('正式提交失败时最近编辑时间与正文一起保持原值，修复后可重试', async () => {
  const { rootDir, service, work, entry } = await setup();
  const fault = new Database(path.join(rootDir, 'works', `${work.id}.sqlite`));
  cleanups.unshift(async () => {
    fault.close();
  });
  const before = service.snapshot(work.id);
  const libraryBefore = service.listWorks();
  fault.exec("CREATE TRIGGER fail_commit AFTER INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, '提交故障'); END;");
  const input = {
    commandId: randomUUID(),
    workId: work.id,
    documentId: entry.id,
    expectedRevisionId: entry.revisionId,
    title: '雨夜',
    format: 'txt' as const,
    content: '新稿'
  };
  expect(() => service.saveDocument(input)).toThrow('提交故障');
  expect(service.snapshot(work.id)).toEqual(before);
  expect(service.readDocument(work.id, entry.id)).toMatchObject({ content: '原稿', revisionId: entry.revisionId });
  expect(service.listWorks()).toEqual(libraryBefore);
  fault.exec('DROP TRIGGER fail_commit');
  const saved = service.saveDocument(input);
  expect(service.readDocument(work.id, entry.id)).toMatchObject({ content: '新稿', revisionId: saved.revisionId });
  expect(service.listWorks()[0]?.updatedAt).toBe(saved.updatedAt);
});
