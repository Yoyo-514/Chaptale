import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, SaveDocumentInput } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function application() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-creation-app-'));
  const app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  return app;
}

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

it('作者入口串接草稿、目录操作和快照，冲突字段与正文均保留', async () => {
  const app = await application();
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  const folder = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'directory',
        title: '第一卷'
      }
    })
  );
  const document = value(
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
        content: '原文'
      }
    })
  );
  const before = value(app.executeAuthor({ method: 'snapshot', input: { workId: work.id } }));
  const draft = {
    workId: work.id,
    documentId: document.id,
    expectedRevisionId: document.revisionId,
    draftId: randomUUID(),
    expectedDraftVersion: null,
    title: '序章',
    format: 'txt' as const,
    content: '草稿\r\n'
  };
  expect(value(app.executeAuthor({ method: 'writeDraft', input: draft }))).toMatchObject({ version: draft.draftId });
  expect(app.executeAuthor({ method: 'writeDraft', input: { ...draft, draftId: randomUUID() } })).toMatchObject({
    ok: false,
    error: { code: 'draft-conflict', actualVersion: draft.draftId }
  });
  expect(
    value(
      app.executeAuthor({
        method: 'discardDraft',
        input: { workId: work.id, documentId: document.id, draftId: draft.draftId }
      })
    )
  ).toEqual({ version: draft.draftId, draft: null });
  value(
    app.executeAuthor({
      method: 'renameDirectory',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        directoryId: folder.id,
        expectedRevisionId: folder.revisionId,
        title: '风起'
      }
    })
  );
  const move = {
    commandId: randomUUID(),
    workId: work.id,
    entryId: document.id,
    expectedParentId: null,
    expectedPosition: document.position,
    parentId: folder.id,
    beforeEntryId: null
  };
  value(app.executeAuthor({ method: 'moveEntry', input: move }));
  expect(app.executeAuthor({ method: 'moveEntry', input: { ...move, commandId: randomUUID() } })).toMatchObject({
    ok: false,
    error: { code: 'entry-location-conflict', actualParentId: folder.id, actualPosition: 0 }
  });
  expect(
    value(app.executeAuthor({ method: 'readDraftState', input: { workId: work.id, documentId: document.id } }))
  ).toEqual({ version: draft.draftId, draft: null });
  expect(
    value(app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: document.revisionId } }))
  ).toMatchObject({ snapshot: { content: '原文' }, source: 'author' });
  const changes = value(app.executeAuthor({ method: 'readChanges', input: { cursor: before.cursor, limit: 10 } }));
  expect(changes).toMatchObject({
    kind: 'changes',
    hasMore: false,
    events: [
      { change: { kind: 'entry', entry: { id: folder.id, title: '风起' } } },
      { change: { kind: 'move', entry: { id: document.id, parentId: folder.id } } }
    ]
  });
});

it.each([
  null,
  [],
  { method: 'close', input: {} },
  { method: 'createWork', input: { commandId: '', title: '作品', kind: 'novel' } },
  { method: 'createWork', input: { commandId: 'command', title: '作品', kind: 'unknown' } },
  { method: 'createWork', input: { commandId: 'command', title: '作品', kind: 'novel' }, caller: 'author' }
])('无效命令和输入中的调用身份不会写入作品库：%j', async command => {
  const app = await application();
  expect(app.executeAuthor(command)).toEqual({
    ok: false,
    error: { code: 'invalid-request', message: '作品请求参数无效' }
  });
  expect(value(app.executeAuthor({ method: 'snapshot', input: { workId: null } }))).toMatchObject({
    kind: 'library',
    works: []
  });
});

it('作者命令创建并保存文稿，过期修订以可序列化冲突返回', async () => {
  const app = await application();
  const work = value(
    app.executeAuthor({
      method: 'createWork',
      input: {
        commandId: randomUUID(),
        title: '长夜行',
        kind: 'novel'
      }
    })
  );
  const entry = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '雨夜',
        format: 'txt',
        content: '原文\r\n'
      }
    })
  );
  const input: SaveDocumentInput = {
    commandId: randomUUID(),
    workId: work.id,
    documentId: entry.id,
    expectedRevisionId: entry.revisionId,
    title: '雨夜',
    format: 'txt' as const,
    content: '新稿\r\n'
  };
  const saved = value(app.executeAuthor({ method: 'saveDocument', input }));
  const conflict = app.executeAuthor({
    method: 'saveDocument',
    input: { ...input, commandId: randomUUID(), content: '旧基线' }
  });
  expect(structuredClone(conflict)).toEqual({
    ok: false,
    error: {
      code: 'revision-conflict',
      message: '内容已有新修订，请比较后再保存',
      expectedRevisionId: entry.revisionId,
      actualRevisionId: saved.revisionId
    }
  });
  expect(
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: entry.id } }))
  ).toMatchObject({ title: '雨夜', content: '新稿\r\n', revisionId: saved.revisionId });
});
