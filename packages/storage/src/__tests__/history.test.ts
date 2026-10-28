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

async function chapter() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-history-'));
  const app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  let entry: Entry = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '第一稿'
      }
    })
  );
  const save = (content: string, title = entry.title) => {
    entry = value(
      app.executeAuthor({
        method: 'saveDocument',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          documentId: entry.id,
          expectedRevisionId: entry.revisionId,
          title,
          format: 'txt',
          content
        }
      })
    );
    return entry;
  };
  const history = () =>
    app.executeAuthor({ method: 'listRevisions', input: { workId: work.id, documentId: entry.id } });
  const contentOf = (revisionId: string) =>
    value(app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId } })).snapshot.content;
  return { app, work, entry: () => entry, save, history, contentOf };
}

it('历史只列正文变化的修订，最新在前，同内容保存不新增', async () => {
  const { save, history, contentOf } = await chapter();
  save('第二稿');
  save('第二稿', '序章（改名）');
  save('第二稿');
  save('第三稿');

  const revisions = value(history());
  expect(revisions.map(item => contentOf(item.id))).toEqual(['第三稿', '第二稿', '第一稿']);
  expect(revisions[0]).toMatchObject({ source: 'author', wordCount: 3 });
});

it('恢复旧版本产生新修订，已有历史保留', async () => {
  const { save, history, contentOf, entry } = await chapter();
  save('第二稿');
  const first = value(history()).at(-1)!;

  save(contentOf(first.id)!);

  const revisions = value(history());
  expect(revisions.map(item => contentOf(item.id))).toEqual(['第一稿', '第二稿', '第一稿']);
  expect(revisions[0]!.id).toBe(entry().revisionId);
  expect(revisions[0]!.id).not.toBe(first.id);
});

it('回收站中的文稿不能查看历史', async () => {
  const { app, work, entry, history } = await chapter();
  value(
    app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: work.id, entryIds: [entry().id] }
    })
  );

  const result = history();
  expect(result.ok).toBe(false);
  expect(result.ok ? '' : result.error.message).toContain('回收站');
});
