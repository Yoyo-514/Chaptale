import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { AgentWriteResult, CreationResult } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

function pending(result: CreationResult<AgentWriteResult>) {
  const written = value(result);
  if (written.kind !== 'pending') throw new Error('预期生成待接受修改');
  return written.change;
}

it('新建目录和子稿按会话持久保存，先接受目录再接受子稿且身份保持', async () => {
  const fixture = await application();
  const { app, work, context } = fixture;
  const folder = pending(
    app.executeAgent(context, {
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
  const chapter = pending(
    app.executeAgent(context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: folder.entryId,
        section: 'manuscript',
        kind: 'document',
        title: '风起',
        format: 'txt',
        content: '城门初开。'
      }
    })
  );
  expect(value(app.executeAuthor({ method: 'listEntries', input: { workId: work.id } }))).toHaveLength(1);
  expect(value(app.executeAgent(context, { method: 'listEntries', input: { workId: work.id } }))).toHaveLength(3);
  await fixture.reopen();
  expect(
    value(
      fixture.app.executeAgent(context, {
        method: 'readDocument',
        input: { workId: work.id, documentId: chapter.entryId }
      })
    ).content
  ).toBe('城门初开。');
  const childView = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: chapter.id } }));
  expect(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(childView), decision: 'accept' }
    })
  ).toMatchObject({ ok: false });
  for (const change of [folder, chapter]) {
    const view = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
    value(
      fixture.app.executeAuthor({
        method: 'decideReview',
        input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
      })
    );
  }
  const official = value(
    fixture.app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: chapter.entryId } })
  );
  expect(official).toMatchObject({ id: chapter.entryId, parentId: folder.entryId, content: '城门初开。' });
});

it('会话内排序重排其他同级位置，正文改名不带入别的候选移动', async () => {
  const { app, work, document, context } = await application();
  const siblings = ['中章', '尾声'].map(title =>
    value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title,
          format: 'txt',
          content: title
        }
      })
    )
  );
  pending(
    app.executeAgent(context, {
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: document.id,
        expectedParentId: null,
        expectedPosition: 0,
        parentId: null,
        beforeEntryId: null
      }
    })
  );
  const entries = value(app.executeAgent(context, { method: 'listEntries', input: { workId: work.id } }));
  // oxlint-disable-next-line unicorn/no-array-sort
  entries.sort((a, b) => a.position - b.position);
  expect(entries.map(entry => entry.id)).toEqual([siblings[0]!.id, siblings[1]!.id, document.id]);
  expect(entries.map(entry => entry.position)).toEqual([0, 1, 2]);
  const renamed = pending(
    app.executeAgent(context, {
      method: 'renameEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: siblings[0]!.id,
        expectedRevisionId: siblings[0]!.revisionId,
        title: '中章改名'
      }
    })
  );
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: renamed.id } }));
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  );
  expect(
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: siblings[0]!.id } }))
  ).toMatchObject({ title: '中章改名', position: 1 });
});

it('审阅打开后作者移动了文稿，即使正文修订没变也拒绝迟到决定', async () => {
  const { app, work, document, propose } = await application();
  const folder = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'directory',
        title: '卷一'
      }
    })
  );
  const change = propose('将军出征。\n公主远行。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    app.executeAuthor({
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: document.id,
        expectedParentId: null,
        expectedPosition: 0,
        parentId: folder.id,
        beforeEntryId: null
      }
    })
  );
  expect(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  ).toMatchObject({ ok: false, error: { message: '正式目录位置已有变化，请刷新审阅内容' } });
});
