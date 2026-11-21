import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Entry, Work } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';
import { application, value } from './fixtures/review.ts';

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
  author('writeWritingGuidelines', { workId: work.id, writingGuidelines: '使用第三人称限知视角，语言平实克制。' });
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
function importPackage(app: CreationApplication, path: string, asCopy = false) {
  return app.execute({ method: 'importWorkPackage', input: { commandId: randomUUID(), path, asCopy } });
}
async function contents(app: CreationApplication, workId: string) {
  const entries = ok(app.executeAuthor({ method: 'listEntries', input: { workId } }));
  const file = entries.find(entry => entry.kind === 'file')!;
  const located = ok(await app.execute({ method: 'locateFile', input: { workId, entryId: file.id, trashed: false } }));
  const document = entries.find(entry => entry.kind === 'document')!;
  return {
    titles: entries.map(entry => entry.title).sort(),
    text: ok(app.executeAuthor({ method: 'readDocument', input: { workId, documentId: document.id } })).content,
    writingGuidelines: ok(app.executeAuthor({ method: 'readWritingGuidelines', input: { workId } })),
    image: [...(await readFile(located.path))]
  };
}
const workDirs = (rootDir: string, workId: string) =>
  readdirSync(join(rootDir, 'works'))
    .filter(name => name.startsWith(workId))
    .sort();

it('导出的作品包导入到另一作品库时按原 ID 加入，正文与资料文件一致', async () => {
  const { app, work } = await source();
  const path = await exportPackage(app, work.id);
  const target = await open(await temp());
  expect(ok(await target.execute({ method: 'inspectWorkPackage', input: { path } }))).toMatchObject({
    work: { id: work.id, title: '长夜行', kind: 'novel' },
    exists: false
  });
  expect(ok(await importPackage(target, path))).toMatchObject({
    work: { id: work.id, title: '长夜行', kind: 'novel' },
    files: []
  });
  expect(await contents(target, work.id)).toEqual(await contents(app, work.id));
  expect(await contents(target, work.id)).toMatchObject({
    titles: ['城门.png', '第一章'],
    text: '夜里下着雨。',
    writingGuidelines: '使用第三人称限知视角，语言平实克制。',
    image: [137, 80, 78, 71, 1, 2, 3]
  });
});

it('导入为副本得到新作品；覆盖时换成包内内容，只保留最新一份导入前快照', async () => {
  const { rootDir, app, work, chapter, author } = await source();
  const path = await exportPackage(app, work.id);
  const save = (content: string) => {
    const current = ok(
      app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: chapter.id } })
    );
    author('saveDocument', {
      workId: work.id,
      documentId: chapter.id,
      expectedRevisionId: current.revisionId,
      title: '第一章',
      format: 'txt',
      content
    });
  };
  save('导出后又改过。');
  expect(ok(await app.execute({ method: 'inspectWorkPackage', input: { path } })).exists).toBe(true);

  const copy = ok(await importPackage(app, path, true)).work;
  expect(copy.id).not.toBe(work.id);
  expect(copy.title).toBe('长夜行（副本）');
  expect((await contents(app, copy.id)).text).toBe('夜里下着雨。');
  expect((await contents(app, work.id)).text).toBe('导出后又改过。');

  expect(ok(await importPackage(app, path)).files).toEqual([]);
  expect((await contents(app, work.id)).text).toBe('夜里下着雨。');
  const [first] = ok(await app.execute({ method: 'listWorkSnapshots', input: {} }));
  expect(first).toMatchObject({ workId: work.id });
  const snapshot = new Database(join(rootDir, 'works', `${work.id}.before-import-${first!.createdAt}`, 'work.sqlite'), {
    readonly: true
  });
  expect(snapshot.prepare('SELECT content FROM entries WHERE id = ?').pluck().get(chapter.id)).toBe('导出后又改过。');
  snapshot.close();

  save('再改一次。');
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = ok(await importPackage(app, path));
  expect(second.files).toEqual([join(rootDir, 'works', `${work.id}.before-import-${first!.createdAt}`)]);
  const snapshots = ok(await app.execute({ method: 'listWorkSnapshots', input: {} }));
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]!.createdAt).toBeGreaterThan(first!.createdAt);
});

it('覆盖导入拒绝该作品全部待审修改；本机草稿保留，按原基线保存时报修订冲突', async () => {
  const fixture = await application();
  const { work, document } = fixture;
  const path = await exportPackage(fixture.app, work.id);
  fixture.propose('Agent 的修改。');
  fixture.save('导出后又改过。');
  const edited = fixture.read();
  const draft = {
    workId: work.id,
    documentId: document.id,
    expectedRevisionId: edited.revisionId,
    draftId: randomUUID(),
    expectedDraftVersion: null,
    title: document.title,
    format: 'txt' as const,
    content: '未保存的草稿'
  };
  value(fixture.app.executeAuthor({ method: 'writeDraft', input: draft }));

  ok(await importPackage(fixture.app, path));
  expect(
    value(fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: work.id, sessionId: null } }))
  ).toEqual([]);
  expect(fixture.read().content).toBe('将军守城。\n公主远行。');
  expect(
    value(fixture.app.executeAuthor({ method: 'readDraftState', input: { workId: work.id, documentId: document.id } }))
  ).toMatchObject({ draft: { content: '未保存的草稿', expectedRevisionId: edited.revisionId } });
  expect(
    fixture.app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: document.id,
        expectedRevisionId: edited.revisionId,
        title: document.title,
        format: 'txt',
        content: '未保存的草稿'
      }
    })
  ).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });
});

it('换回导入前快照：恢复内容与作品信息，换下的目录交给平台，快照不再列出', async () => {
  const { rootDir, app, work, chapter, author } = await source();
  const path = await exportPackage(app, work.id);
  const packaged = new Database(path);
  packaged.prepare('UPDATE package_meta SET work = ?').run(JSON.stringify({ ...work, title: '包里的名字' }));
  packaged.close();
  const current = ok(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: chapter.id } }));
  author('saveDocument', {
    workId: work.id,
    documentId: chapter.id,
    expectedRevisionId: current.revisionId,
    title: '第一章',
    format: 'txt',
    content: '覆盖前的内容。'
  });
  ok(await importPackage(app, path));
  expect(ok(app.executeAuthor({ method: 'listWorks', input: {} }))[0]!.title).toBe('包里的名字');

  const restored = ok(
    await app.execute({ method: 'restoreWorkSnapshot', input: { commandId: randomUUID(), workId: work.id } })
  );
  expect(restored.work.title).toBe('长夜行');
  expect(restored.files).toHaveLength(1);
  expect(restored.files[0]).toMatch(new RegExp(`${work.id}\\.replaced-\\d+$`));
  expect(existsSync(restored.files[0]!)).toBe(true);
  expect(ok(app.executeAuthor({ method: 'listWorks', input: {} }))[0]!.title).toBe('长夜行');
  expect(await contents(app, work.id)).toMatchObject({ text: '覆盖前的内容。', image: [137, 80, 78, 71, 1, 2, 3] });
  expect(ok(await app.execute({ method: 'listWorkSnapshots', input: {} }))).toEqual([]);
  expect(existsSync(join(rootDir, 'works', work.id, 'work.json'))).toBe(false);
  expect(
    await app.execute({ method: 'restoreWorkSnapshot', input: { commandId: randomUUID(), workId: work.id } })
  ).toMatchObject({ ok: false, error: { message: '这部作品没有导入前的内容' } });
});

it('覆盖导入在作品库提交失败时换回原目录，不留快照与展开目录', async () => {
  const { rootDir, app, work } = await source();
  const path = await exportPackage(app, work.id);
  const before = await contents(app, work.id);
  const library = new Database(join(rootDir, 'library.sqlite'));
  library.exec(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, '注入的提交失败'); END"
  );
  library.close();

  expect(await importPackage(app, path)).toMatchObject({ ok: false, error: { message: '注入的提交失败' } });
  expect(workDirs(rootDir, work.id)).toEqual([work.id]);
  expect(await contents(app, work.id)).toEqual(before);

  expect(await importPackage(app, path, true)).toMatchObject({ ok: false, error: { message: '注入的提交失败' } });
  expect(readdirSync(join(rootDir, 'works'))).toEqual([work.id]);
  expect(ok(app.executeAuthor({ method: 'listWorks', input: {} })).map(item => item.id)).toEqual([work.id]);
});

it('永久删除作品时导入前快照一并交给平台', async () => {
  const { rootDir, app, work } = await source();
  const path = await exportPackage(app, work.id);
  ok(await importPackage(app, path));
  ok(app.executeAuthor({ method: 'trashWork', input: { commandId: randomUUID(), workId: work.id } }));
  const purged = ok(app.executeAuthor({ method: 'purgeWork', input: { commandId: randomUUID(), workId: work.id } }));
  expect(purged.files.map(file => file.slice(join(rootDir, 'works').length + 1)).sort()).toEqual(
    workDirs(rootDir, work.id)
  );
  expect(purged.files).toHaveLength(2);
});

it('另存副本时恢复作品技能、引用资料和停用设置，已移除的技能留在原设备', async () => {
  const { rootDir, app, work } = await source();
  const skills = join(rootDir, 'works', work.id, 'skills');
  await mkdir(join(skills, '润色', 'references'), { recursive: true });
  await writeFile(join(skills, '润色', 'SKILL.md'), '保留原意。');
  await writeFile(join(skills, '润色', 'references', '例子.txt'), '改前与改后');
  const disabled = JSON.stringify({ disabled: ['润色'] });
  await writeFile(join(skills, '.disabled.json'), disabled);
  await mkdir(join(skills, '.trash'));
  await writeFile(join(skills, '.trash', '旧技能'), '已删除');
  const targetDir = await temp();
  const target = await open(targetDir);
  const copy = ok(await importPackage(target, await exportPackage(app, work.id), true));
  const restored = join(targetDir, 'works', copy.work.id, 'skills');
  expect(await readFile(join(restored, '润色', 'SKILL.md'), 'utf8')).toBe('保留原意。');
  expect(await readFile(join(restored, '润色', 'references', '例子.txt'), 'utf8')).toBe('改前与改后');
  expect(await readFile(join(restored, '.disabled.json'), 'utf8')).toBe(disabled);
  expect(existsSync(join(restored, '.trash'))).toBe(false);
});

it('包内技能路径越过技能目录时不覆盖原作品', async () => {
  const { app, work } = await source();
  const before = await contents(app, work.id);
  const path = await exportPackage(app, work.id);
  const database = new Database(path);
  database.prepare('INSERT INTO package_skills VALUES (?, ?)').run('../work.sqlite', Buffer.from('损坏内容'));
  database.close();
  expect(await importPackage(app, path)).toMatchObject({
    ok: false,
    error: { message: '作品包内容无效：技能路径不合法' }
  });
  expect(await contents(app, work.id)).toEqual(before);
});

it('第一版作品包没有技能表也能恢复正文和资料', async () => {
  const { app, work } = await source();
  const path = await exportPackage(app, work.id);
  const database = new Database(path);
  database.exec('DROP TABLE IF EXISTS package_skills; UPDATE package_meta SET format = 1');
  database.close();
  const target = await open(await temp());
  ok(await importPackage(target, path));
  expect(await contents(target, work.id)).toEqual(await contents(app, work.id));
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
  expect(await importPackage(target, path)).toMatchObject({
    ok: false,
    error: { message: '作品包由更新版本的 Chaptale 导出，请升级应用后导入' }
  });
  expect(ok(target.executeAuthor({ method: 'listWorks', input: {} }))).toEqual([]);
});

it('作品包里的文件路径指向条目目录之外时拒绝导入，不写出任何文件', async () => {
  const { app, work } = await source();
  const path = await exportPackage(app, work.id);
  const database = new Database(path);
  database.prepare('UPDATE package_files SET fileName = ?').run('../../../逃逸.txt');
  database.close();
  const rootDir = await temp();
  const target = await open(rootDir);
  expect(await importPackage(target, path)).toMatchObject({
    ok: false,
    error: { message: '作品包内容无效：文件路径不合法' }
  });
  expect(readdirSync(join(rootDir, 'works'))).toEqual([]);
  expect(existsSync(join(rootDir, '逃逸.txt'))).toBe(false);
  expect(ok(target.executeAuthor({ method: 'listWorks', input: {} }))).toEqual([]);
});
