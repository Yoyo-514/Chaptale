import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { application, target, value } from './fixtures/review.ts';

it('作者保存的手改候选可供 Agent 读取和继续补改，迟到版本保持冲突', async () => {
  const f = await application();
  const proposed = f.propose('将军出城。\n公主远行。');
  const view = value(f.app.executeAuthor({ method: 'readReview', input: { changeId: proposed.id } }));
  value(
    f.app.executeAuthor({
      method: 'updateReview',
      input: {
        ...target(view),
        commandId: randomUUID(),
        title: f.document.title,
        content: '将军夜里出城。\n公主远行。',
        resolveConflicts: false
      }
    })
  );
  const current = value(
    f.app.executeAgent(f.context, {
      method: 'readDocument',
      input: { workId: f.work.id, documentId: f.document.id }
    })
  );
  expect(current).toMatchObject({ content: '将军夜里出城。\n公主远行。', pending: true });
  const write = (revisionId: string) =>
    f.app.executeAgent(f.context, {
      method: 'writeContent',
      input: {
        commandId: randomUUID(),
        workId: f.work.id,
        documentId: f.document.id,
        expectedRevisionId: revisionId,
        content: '将军夜里悄然出城。\n公主远行。'
      }
    });
  expect(write(proposed.version)).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });
  expect(write(current.revisionId)).toMatchObject({ ok: true, value: { kind: 'pending' } });
  expect(f.read().content).toBe('将军守城。\n公主远行。');
});

it('拒绝一块正文后立刻形成独立处理结果，保留被拒绝的片段和其余待审内容', async () => {
  const f = await application();
  const proposed = f.propose('将军出城。\n公主南下。');
  const view = value(f.app.executeAuthor({ method: 'readReview', input: { changeId: proposed.id } }));
  const input = {
    ...target(view),
    commandId: randomUUID(),
    decision: 'reject' as const,
    range: { fromA: 0, toA: 5, fromB: 0, toB: 5 }
  };
  value(f.app.executeAuthor({ method: 'decideReview', input }));
  const results = value(
    f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } })
  );
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    part: 'body',
    decision: 'rejected',
    before: '将军守城。',
    proposed: '将军出城。'
  });
  expect(
    value(
      f.app.executeAuthor({
        method: 'listPendingChanges',
        input: { workId: f.work.id, sessionId: f.context.sessionId }
      })
    )
  ).toHaveLength(1);
  value(f.app.executeAuthor({ method: 'decideReview', input }));
  expect(
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
  ).toHaveLength(1);
  await f.reopen();
  expect(
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
  ).toHaveLength(1);
});

it('只保存手改仍待审，接受后报告手改标记；发送前读取最新正式稿且进度跨重启保存', async () => {
  const f = await application();
  const change = f.propose('候选正文');
  const initial = value(f.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    f.app.executeAuthor({
      method: 'updateReview',
      input: {
        ...target(initial),
        commandId: randomUUID(),
        title: f.document.title,
        content: '作者手改正文',
        resolveConflicts: false
      }
    })
  );
  const list = () =>
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }));
  expect(list()).toEqual([]);
  const edited = value(f.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    f.app.executeAuthor({
      method: 'decideReview',
      input: { ...target(edited), commandId: randomUUID(), decision: 'accept' }
    })
  );
  expect(list()).toEqual([
    expect.objectContaining({ decision: 'accepted', authorEdited: true, proposed: '作者手改正文' })
  ]);
  f.save('作者后续保存的正式稿');
  expect(list()[0].snapshot).toMatchObject({ content: '作者后续保存的正式稿' });
  expect(value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: '另一会话' } }))).toEqual([]);
  const resultIds = list().map(result => result.id);
  value(f.app.executeAuthor({ method: 'reportReviewResults', input: { sessionId: f.context.sessionId, resultIds } }));
  await f.reopen();
  expect(list()).toEqual([]);
  value(f.app.executeAuthor({ method: 'reportReviewResults', input: { sessionId: f.context.sessionId, resultIds } }));
  expect(list()).toEqual([]);
});

it('直接保存与候选相同的内容后，原候选仍作为一项等待作者确认', async () => {
  const f = await application();
  const change = f.propose('相同正文');
  f.save('相同正文');
  const items = value(f.app.executeAuthor({ method: 'listReviewItems', input: { sessionId: f.context.sessionId } }));
  expect(items).toEqual([expect.objectContaining({ count: 1 })]);
  const view = value(f.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    f.app.executeAuthor({
      method: 'decideReview',
      input: { ...target(view), commandId: randomUUID(), decision: 'accept' }
    })
  );
  expect(
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
  ).toEqual([expect.objectContaining({ part: 'entry', decision: 'accepted' })]);
});

it('标题、资料属性整组和相隔的正文块分别计数，逐项决定保留其他待审部分', async () => {
  const f = await application();
  const resource = value(
    f.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: f.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '人物',
        format: 'txt',
        content: '第一句。\n原句。\n第三句。'
      }
    })
  );
  const proposed = value(
    f.app.executeAgent(f.context, {
      method: 'writeDocument',
      input: {
        commandId: randomUUID(),
        workId: f.work.id,
        documentId: resource.id,
        expectedRevisionId: resource.revisionId,
        title: '人物改名',
        format: 'txt',
        content: '首句。\n原句。\n末句。',
        attributes: { aliases: ['别名'] }
      }
    })
  );
  if (proposed.kind !== 'pending') throw new Error('预期生成待接受修改');
  const items = value(f.app.executeAuthor({ method: 'listReviewItems', input: { sessionId: f.context.sessionId } }));
  expect(items).toEqual([expect.objectContaining({ count: 4 })]);
  const read = () => value(f.app.executeAuthor({ method: 'readReview', input: { changeId: proposed.change.id } }));
  value(
    f.app.executeAuthor({
      method: 'decideReview',
      input: { ...target(read()), commandId: randomUUID(), decision: 'reject', part: 'attributes' }
    })
  );
  expect(
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
  ).toEqual([expect.objectContaining({ part: 'attributes', decision: 'rejected' })]);
  expect(read().change.status).toBe('pending');
});
