import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Entry, Work } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const task of cleanup.splice(0).reverse()) await task();
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'chaptale-package-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function open(rootDir: string) {
  const app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => app.close());
  return app;
}
function ok<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 一部有正文与资料图片的作品。 */
async function source() {
  const rootDir = await temp();
  const app = await open(rootDir);
  const author = <T>(method: string, input: object) =>
    ok(app.executeAuthor({ method, input: { commandId: randomUUID(), ...input } } as never) as CreationResult<T>);
  const work = author<Work>('createWork', { title: '长夜行', kind: 'novel' });
  const chapter = author<Entry>('createEntry', {
    workId: work.id,
    parentId: null,
    section: 'manuscript',
    kind: 'document',
    title: '第一章',
    format: 'txt',
    content: '夜里下着雨。'
  });
  const image = join(rootDir, '城门.png');
  await writeFile(image, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  ok(
    await app.execute({
      method: 'addFiles',
      input: { commandId: randomUUID(), workId: work.id, parentId: null, paths: [image] }
    })
  );
  return { rootDir, app, work, chapter, author };
}
async function exportPackage(app: CreationApplication, workId: string) {
  const path = join(await temp(), '长夜行.chaptale');
  ok(await app.execute({ method: 'exportWorkPackage', input: { workId, path } }));
  return path;
}
async function contents(app: CreationApplication, workId: string) {
  const entries = ok(app.executeAuthor({ method: 'listEntries', input: { workId } }));
  const file = entries.find(entry => entry.kind === 'file')!;
  const located = ok(await app.execute({ method: 'locateFile', input: { workId, entryId: file.id, trashed: false } }));
  return {
    titles: entries.map(entry => entry.title).sort(),
    text: ok(
      app.executeAuthor({
        method: 'readDocument',
        input: { workId, documentId: entries.find(e => e.kind === 'document')!.id }
      })
    ).content,
    image: [...(await readFile(located.path))]
  };
}

it('导出的作品包导入到另一作品库时按原 ID 加入，正文与资料文件一致', async () => {
  const { app, work } = await source();
  const path = await exportPackage(app, work.id);
  const target = await open(await temp());
  expect(ok(await target.execute({ method: 'inspectWorkPackage', input: { path } }))).toMatchObject({
    work: { id: work.id, title: '长夜行', kind: 'novel' },
    exists: false
  });
  const imported = ok(
    await target.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy: false } })
  );
  expect(imported).toMatchObject({ id: work.id, title: '长夜行', kind: 'novel' });
  expect(await contents(target, work.id)).toEqual(await contents(app, work.id));
  expect(await contents(target, work.id)).toMatchObject({
    titles: ['城门.png', '第一章'],
    text: '夜里下着雨。',
    image: [137, 80, 78, 71, 1, 2, 3]
  });
});

it('同一作品库导入为副本得到新作品；覆盖时换成包内内容，原目录留作恢复快照', async () => {
  const { rootDir, app, work, chapter, author } = await source();
  const path = await exportPackage(app, work.id);
  author('saveDocument', {
    workId: work.id,
    documentId: chapter.id,
    expectedRevisionId: chapter.revisionId,
    title: '第一章',
    format: 'txt',
    content: '导出后又改过。'
  });
  expect(ok(await app.execute({ method: 'inspectWorkPackage', input: { path } })).exists).toBe(true);

  const copy = ok(
    await app.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy: true } })
  );
  expect(copy.id).not.toBe(work.id);
  expect(copy.title).toBe('长夜行（副本）');
  expect((await contents(app, copy.id)).text).toBe('夜里下着雨。');
  expect((await contents(app, work.id)).text).toBe('导出后又改过。');

  ok(await app.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy: false } }));
  expect((await contents(app, work.id)).text).toBe('夜里下着雨。');
  const snapshots = readdirSync(join(rootDir, 'works')).filter(name => name.startsWith(`${work.id}.before-import-`));
  expect(snapshots).toHaveLength(1);
  const snapshot = new Database(join(rootDir, 'works', snapshots[0]!, 'work.sqlite'), { readonly: true });
  expect(snapshot.prepare('SELECT content FROM entries WHERE id = ?').pluck().get(chapter.id)).toBe('导出后又改过。');
  snapshot.close();
});

it('非作品包与版本更新的作品包拒绝导入，作品库不变', async () => {
  const { app, work } = await source();
  const dir = await temp();
  const text = join(dir, '笔记.chaptale');
  await writeFile(text, '不是数据库');
  expect(await app.execute({ method: 'inspectWorkPackage', input: { path: text } })).toMatchObject({
    ok: false,
    error: { message: '所选文件不是 Chaptale 作品包' }
  });
  const path = await exportPackage(app, work.id);
  const database = new Database(path);
  database.pragma('user_version = 9');
  database.close();
  const target = await open(await temp());
  expect(
    await target.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy: false } })
  ).toMatchObject({ ok: false, error: { message: '作品包由更新版本的 Chaptale 导出，请升级应用后导入' } });
  expect(ok(target.executeAuthor({ method: 'listWorks', input: {} }))).toEqual([]);
  expect(existsSync(join(path, '..', `${work.id}.importing`))).toBe(false);
});

it('作品包里的文件路径指向条目目录之外时拒绝导入，不写出任何文件', async () => {
  const { app, work } = await source();
  const path = await exportPackage(app, work.id);
  const database = new Database(path);
  database.prepare('UPDATE package_files SET fileName = ?').run('../../../逃逸.txt');
  database.close();
  const rootDir = await temp();
  const target = await open(rootDir);
  expect(
    await target.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy: false } })
  ).toMatchObject({ ok: false, error: { message: '作品包内容无效：文件路径不合法' } });
  expect(readdirSync(join(rootDir, 'works'))).toEqual([]);
  expect(existsSync(join(rootDir, '逃逸.txt'))).toBe(false);
  expect(ok(target.executeAuthor({ method: 'listWorks', input: {} }))).toEqual([]);
});
