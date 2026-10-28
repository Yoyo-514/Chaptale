import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Entry, ResourceAttributes } from '@chaptale/creation/contracts';

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
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-attributes-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  const create = (section: Entry['section'], title: string) =>
    value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId: null,
          section,
          kind: 'document',
          title,
          format: 'txt',
          content: ''
        }
      })
    );
  const save = (entry: Entry, attributes?: ResourceAttributes) =>
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: entry.title,
        format: 'txt',
        content: '正文',
        ...(attributes && { attributes })
      }
    });
  const reopen = async () => {
    app.close();
    app = new CreationApplication(await openCreationStorage({ rootDir }));
  };
  const read = (entry: Entry) =>
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: entry.id } }));
  return { app: () => app, work, create, save, reopen, read };
}

it('资料属性随正文保存为修订，重开后保留；文稿不接受属性，省略时保持原属性', async () => {
  const { create, save, reopen, read } = await workspace();
  const resource = create('resource', '林晚');
  expect(read(resource).attributes).toEqual({ type: '', aliases: [], tags: [] });
  const attributes = { type: '人物', aliases: ['小林'], tags: ['主角'] };
  const saved = value(save(resource, attributes));
  expect(saved.revisionId).not.toBe(resource.revisionId);
  expect(value(save(saved, attributes)).revisionId).toBe(saved.revisionId);

  await reopen();
  expect(read(saved).attributes).toEqual(attributes);
  const renamed = value(save({ ...saved, title: '林晚晴' }));
  expect(read(renamed).attributes).toEqual(attributes);

  const chapter = create('manuscript', '序章');
  expect(read(chapter).attributes).toBeNull();
  expect(save(chapter, attributes)).toMatchObject({ ok: false, error: { message: '文稿没有属性' } });
});

it('搜别名能找到资料', async () => {
  const { app, work, create, save } = await workspace();
  const resource = create('resource', '林晚');
  value(save(resource, { type: '人物', aliases: ['青鸟'], tags: [] }));
  const page = value(
    app().executeAuthor({
      method: 'searchDocuments',
      input: { workId: work.id, query: '青鸟', offset: 0, limit: 10 }
    })
  );
  expect(page.entries.map(entry => entry.id)).toEqual([resource.id]);
});
