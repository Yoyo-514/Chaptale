import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

async function workspace() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-files-'));
  const outside = join(rootDir, 'outside');
  await mkdir(outside);
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  const source = async (name: string, content: string) => {
    const path = join(outside, name);
    await writeFile(path, content);
    return path;
  };
  const add = async (paths: string[], commandId: string = randomUUID(), parentId: string | null = null) =>
    value(await app.execute({ method: 'addFiles', input: { commandId, workId: work.id, parentId, paths } }));
  const locate = (entry: Entry) => app.execute({ method: 'locateFile', input: { workId: work.id, entryId: entry.id } });
  const list = () => value(app.executeAuthor({ method: 'listEntries', input: { workId: work.id } }));
  const reopen = async () => {
    app.close();
    app = new CreationApplication(await openCreationStorage({ rootDir }));
  };
  return { rootDir, app: () => app, work, source, add, locate, list, reopen };
}

it('添加时复制文件，原文件移走后条目仍可用，外部修改后读取到最新文件', async () => {
  const { rootDir, work, source, add, locate, list, reopen } = await workspace();
  const original = await source('地图.png', 'v1');
  const report = await add([original]);
  expect(report.failure).toBeNull();
  const [entry] = report.entries;
  expect(entry).toMatchObject({ section: 'resource', kind: 'file', title: '地图.png', fileName: '地图.png' });
  await rm(original);
  await reopen();
  expect(list()).toEqual([entry]);
  const location = value(await locate(entry!));
  expect(location.path).toBe(join(rootDir, 'works', work.id, 'files', entry!.id, '地图.png'));
  expect(await readFile(location.path, 'utf8')).toBe('v1');
  await writeFile(location.path, 'version 2');
  expect(value(await locate(entry!)).size).toBe(9);
});

it('按顺序添加，遇到文件夹停止并返回已完成项；同一命令重试不重复登记也不留下副本', async () => {
  const { rootDir, work, source, add, list } = await workspace();
  const first = await source('设定.pdf', 'pdf');
  const commandId = randomUUID();
  const report = await add([first, join(rootDir, 'outside'), await source('其他.docx', 'doc')], commandId);
  expect(report.entries.map(entry => entry.title)).toEqual(['设定.pdf']);
  expect(report.failure).toEqual({ path: join(rootDir, 'outside'), message: '只能添加文件，不能添加文件夹' });
  const retried = await add([first], commandId);
  expect(retried.entries).toEqual(report.entries);
  expect(list()).toHaveLength(1);
  expect(await readdir(join(rootDir, 'works', work.id, 'files'))).toEqual([report.entries[0]!.id]);
});

it('改名、移动记录修订且文件名不变，检索按名称命中', async () => {
  const { app, work, source, add, locate } = await workspace();
  const [entry] = (await add([await source('lin.png', 'img')])).entries;
  const folder = value(
    app().executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'resource',
        kind: 'directory',
        title: '人物'
      }
    })
  );
  const renamed = value(
    app().executeAuthor({
      method: 'renameEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: entry!.id,
        expectedRevisionId: entry!.revisionId,
        title: '林晚立绘'
      }
    })
  );
  expect(renamed).toMatchObject({ title: '林晚立绘', fileName: 'lin.png' });
  expect(
    value(app().executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: renamed.revisionId } }))
  ).toMatchObject({ parentRevisionId: entry!.revisionId, snapshot: { title: '林晚立绘', content: null } });
  const moved = value(
    app().executeAuthor({
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: entry!.id,
        expectedParentId: null,
        expectedPosition: renamed.position,
        parentId: folder.id,
        beforeEntryId: null
      }
    })
  );
  expect(moved.parentId).toBe(folder.id);
  expect(value(await locate(entry!)).path.endsWith('lin.png')).toBe(true);
  const page = value(
    app().executeAuthor({
      method: 'searchDocuments',
      input: { workId: work.id, query: '立绘', offset: 0, limit: 10 }
    })
  );
  expect(page.entries.map(item => item.id)).toEqual([entry!.id]);
});

it('移入回收站时保留文件，恢复后可用，永久清空时删除文件', async () => {
  const { app, work, source, add, locate } = await workspace();
  const [entry] = (await add([await source('map.png', 'img')])).entries;
  const { path } = value(await locate(entry!));
  const trashed = value(
    app().executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: work.id, entryIds: [entry!.id] }
    })
  );
  expect(trashed.map(item => item.id)).toEqual([entry!.id]);
  expect(await locate(entry!)).toMatchObject({ ok: false, error: { message: '条目在回收站中' } });
  expect(existsSync(path)).toBe(true);
  const [batch] = value(app().executeAuthor({ method: 'listTrash', input: { workId: work.id } }));
  value(
    app().executeAuthor({
      method: 'restoreTrash',
      input: { commandId: randomUUID(), workId: work.id, batchId: batch!.id }
    })
  );
  expect(value(await locate(entry!)).path).toBe(path);
  value(
    app().executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: work.id, entryIds: [entry!.id] }
    })
  );
  value(
    app().executeAuthor({ method: 'purgeTrash', input: { commandId: randomUUID(), workId: work.id, batchId: null } })
  );
  expect(existsSync(join(path, '..'))).toBe(false);
});

it('封面只能选资料中的图片文件条目，随属性保存', async () => {
  const { app, work, source, add } = await workspace();
  const [image, pdf] = (await add([await source('lin.webp', 'img'), await source('notes.pdf', 'pdf')])).entries;
  const resource = value(
    app().executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '林晚',
        format: 'txt',
        content: ''
      }
    })
  );
  const save = (cover: string) =>
    app().executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: resource.id,
        expectedRevisionId: resource.revisionId,
        title: resource.title,
        format: 'txt',
        content: '',
        attributes: { type: '人物', aliases: [], tags: [], cover }
      }
    });
  expect(save(pdf!.id)).toMatchObject({ ok: false, error: { message: '封面需要选择资料中的图片' } });
  expect(save(resource.id)).toMatchObject({ ok: false, error: { message: '封面需要选择资料中的图片' } });
  value(save(image!.id));
  expect(
    value(app().executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: resource.id } }))
      .attributes
  ).toEqual({ type: '人物', aliases: [], tags: [], cover: image!.id });
});
