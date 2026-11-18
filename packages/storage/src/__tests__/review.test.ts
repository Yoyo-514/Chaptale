import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';
import { searchEntries, searchWork } from './fixtures/search.ts';

it('审阅改稿按会话隔离，接受后生成正式修订', async () => {
  const fixture = await application();
  const { app, work, document, context, propose } = fixture;
  const change = propose('将军出征。\n公主远行。');
  const read = { method: 'readDocument' as const, input: { workId: work.id, documentId: document.id } };
  expect(fixture.read().content).toBe('将军守城。\n公主远行。');
  expect(value(app.executeAgent(context, read)).content).toBe('将军出征。\n公主远行。');
  expect(value(app.executeAgent({ sessionId: 'session-b', mode: 'review' }, read)).content).toBe(
    '将军守城。\n公主远行。'
  );
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect(
    value(
      app.executeAuthor({
        method: 'decideReview',
        input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
      })
    ).status
  ).toBe('accepted');
  const saved = fixture.read();
  expect(saved.content).toBe('将军出征。\n公主远行。');
  expect(
    value(app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: saved.revisionId } }))
  ).toMatchObject({ source: 'review', parentRevisionId: document.revisionId });
  expect(
    value(app.executeAuthor({ method: 'listPendingChanges', input: { workId: work.id, sessionId: null } }))
  ).toEqual([]);
});

it('审阅搜索叠加自己的改稿，其他会话和正式检索保留原文，拒绝后恢复', async () => {
  const { app, work, context, propose } = await application();
  const change = propose('将军出征。\n公主远行。');
  const marching = { workId: work.id, query: '出征' };
  const guarding = { workId: work.id, query: '守城' };
  // 命中的是候选正文：修订为候选版本，段落取自改稿。
  expect(searchWork(app, marching, context).hits).toEqual([
    {
      kind: 'entry',
      entry: expect.objectContaining({ id: change.targetId, revisionId: change.version }),
      pending: true,
      ignoresAsOf: false,
      passages: [{ startLine: 1, endLine: 2, text: '将军出征。\n公主远行。' }]
    }
  ]);
  expect(searchEntries(app, marching)).toEqual([]);
  expect(searchEntries(app, marching, { ...context, sessionId: 'session-b' })).toEqual([]);
  expect(searchEntries(app, guarding, context)).toEqual([]);
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'reject' }
    })
  );
  expect(searchEntries(app, marching, context)).toEqual([]);
  expect(searchWork(app, guarding, context).hits).toMatchObject([
    { kind: 'entry', pending: false, passages: [{ startLine: 1, endLine: 2, text: '将军守城。\n公主远行。' }] }
  ]);
});

it('讨论拒绝写入，直接修改生成 Agent 修订并按命令身份重试', async () => {
  const fixture = await application();
  const { app, work, document, context } = fixture;
  const command = {
    method: 'editDocument' as const,
    input: {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      oldText: '守城',
      newText: '出征'
    }
  };
  expect(app.executeAgent({ ...context, mode: 'discuss' }, command)).toMatchObject({
    ok: false,
    error: { message: '当前为讨论模式，作品只读' }
  });
  expect(fixture.read().revisionId).toBe(document.revisionId);
  const result = value(app.executeAgent({ ...context, mode: 'direct' }, command));
  expect(result.kind).toBe('saved');
  expect(value(app.executeAgent({ ...context, mode: 'direct' }, command))).toEqual(result);
  expect(fixture.read().content).toBe('将军出征。\n公主远行。');
  expect(
    value(
      app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: fixture.read().revisionId } })
    )
  ).toMatchObject({ source: 'agent' });
});

it('精确替换拒绝缺失、重复和空原文，陈旧候选版本不覆盖新稿', async () => {
  const fixture = await application();
  const { app, work, document, context } = fixture;
  for (const oldText of ['不存在', '。', '']) {
    expect(
      app.executeAgent(context, {
        method: 'editDocument',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          documentId: document.id,
          expectedRevisionId: document.revisionId,
          oldText,
          newText: '新文字'
        }
      })
    ).toMatchObject({ ok: false });
  }
  const change = fixture.propose('将军出征。\n公主远行。');
  expect(
    app.executeAgent(context, {
      method: 'editDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: document.id,
        expectedRevisionId: document.revisionId,
        oldText: '远行',
        newText: '回城'
      }
    })
  ).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });
  expect(
    (value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } })).candidate as EntrySnapshot)
      .content
  ).toBe('将军出征。\n公主远行。');
});

it('不存在的候选请求不会留下阻塞后续审阅的提交意图', async () => {
  const { app } = await application();
  expect(
    app.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        changeId: 'missing',
        expectedVersion: 'missing',
        expectedRevisionId: null,
        expectedLocation: null,
        decision: 'accept'
      }
    })
  ).toMatchObject({ ok: false });
  expect(value(app.executeAuthor({ method: 'listPendingChanges', input: { workId: null, sessionId: null } }))).toEqual(
    []
  );
});
