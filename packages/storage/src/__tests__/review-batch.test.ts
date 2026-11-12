import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { application, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;
function createNote(f: Fixture) {
  const result = value(
    f.app.executeAgent(f.context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: f.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '人物',
        format: 'markdown',
        content: '将军决定出征。'
      }
    })
  );
  if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
  return result.change;
}
function items(f: Fixture) {
  return value(f.app.executeAuthor({ method: 'listReviewItems', input: { sessionId: f.context.sessionId } }));
}
function command(f: Fixture, decision: 'accept' | 'reject') {
  return {
    method: 'decidePending' as const,
    input: {
      commandId: randomUUID(),
      sessionId: f.context.sessionId,
      workId: f.work.id,
      decision,
      targets: items(f).map(item => item.target)
    }
  };
}
it('一次接受本会话的正文与新资料，重复命令沿用原回执和处理结果', async () => {
  const f = await application();
  f.propose('将军出征。\n公主远行。');
  const note = createNote(f);
  expect(items(f).map(item => ['title' in item ? item.title : '', item.created])).toEqual([
    ['序章', false],
    ['人物', true]
  ]);
  const request = command(f, 'accept');
  const accepted = value(f.app.executeAuthor(request));
  expect(accepted.count).toBe(2);
  expect(f.read().content).toBe('将军出征。\n公主远行。');
  expect(
    value(f.app.executeAuthor({ method: 'readDocument', input: { workId: f.work.id, documentId: note.targetId } }))
      .content
  ).toBe('将军决定出征。');
  expect(items(f)).toEqual([]);
  expect(value(f.app.executeAuthor(request))).toEqual(accepted);
  expect(
    value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
  ).toHaveLength(2);
});
it('任一冲突或候选变化使整批接受保持原状，批量拒绝仍可处理冲突', async () => {
  const f = await application();
  f.propose('将军出征。\n公主远行。');
  createNote(f);
  f.save('将军回城。\n公主远行。');
  const before = items(f);
  expect(before.find(item => 'title' in item && item.title === '序章')!.conflicted).toBe(true);
  expect(f.app.executeAuthor(command(f, 'accept'))).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('《序章》') }
  });
  expect(f.read().content).toBe('将军回城。\n公主远行。');
  expect(value(f.app.executeAuthor({ method: 'listEntries', input: { workId: f.work.id } }))).toHaveLength(1);
  const stale = command(f, 'reject');
  stale.input.targets = stale.input.targets.slice(0, 1);
  expect(f.app.executeAuthor(stale)).toMatchObject({ ok: false, error: { message: '待审修改已变化，请刷新后处理' } });
  value(f.app.executeAuthor(command(f, 'reject')));
  expect(items(f)).toEqual([]);
});
it('作品提交后本机进度失败，重开凭回执恢复原始片段且正式修订只提交一次', async () => {
  const f = await application();
  f.propose('将军出征。\n公主远行。');
  const note = createNote(f);
  const request = command(f, 'accept');
  const fault = new Database(join(f.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(f.app.executeAuthor(request)).toMatchObject({ ok: false, error: { message: '审阅进度故障' } });
    const saved = f.read();
    expect(saved.content).toBe('将军出征。\n公主远行。');
    fault.exec('DROP TRIGGER fail_progress');
    await f.reopen();
    expect(items(f)).toEqual([]);
    expect(value(f.app.executeAuthor(request)).count).toBe(2);
    expect(f.read()).toEqual(saved);
    expect(
      value(f.app.executeAuthor({ method: 'listEntries', input: { workId: f.work.id } })).filter(
        entry => entry.id === note.targetId
      )
    ).toHaveLength(1);
    const results = value(
      f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } })
    );
    expect(results).toHaveLength(2);
    expect(results.find(result => result.part === 'body')).toMatchObject({
      before: '将军守城。',
      proposed: '将军出征。'
    });
  } finally {
    fault.close();
  }
});
it('进度中断后永久清空作品，同时清除该作品的提交意图与处理结果', async () => {
  const f = await application();
  f.propose('将军出征。\n公主远行。');
  const request = command(f, 'accept');
  const fault = new Database(join(f.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(f.app.executeAuthor(request)).toMatchObject({ ok: false });
    fault.exec('DROP TRIGGER fail_progress');
    value(f.app.executeAuthor({ method: 'trashWork', input: { commandId: randomUUID(), workId: f.work.id } }));
    value(f.app.executeAuthor({ method: 'purgeWork', input: { commandId: randomUUID(), workId: f.work.id } }));
    expect(
      value(f.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: f.context.sessionId } }))
    ).toEqual([]);
  } finally {
    fault.close();
  }
});

it('候选按会话隔离，直接修改立即写入正式稿并保留原有待审候选', async () => {
  const f = await application();
  const pending = f.propose('旧候选');
  const request = {
    method: 'editDocument' as const,
    input: {
      commandId: randomUUID(),
      workId: f.work.id,
      documentId: f.document.id,
      expectedRevisionId: f.document.revisionId,
      oldText: '守城',
      newText: '驻城'
    }
  };
  expect(value(f.app.executeAgent({ ...f.context, mode: 'direct' }, request)).kind).toBe('saved');
  expect(value(f.app.executeAgent({ ...f.context, mode: 'direct' }, request)).kind).toBe('saved');
  expect(f.read().content).toBe('将军驻城。\n公主远行。');
  expect(
    value(
      f.app.executeAuthor({
        method: 'listPendingChanges',
        input: { workId: f.work.id, sessionId: f.context.sessionId }
      })
    )
  ).toEqual([pending]);
  expect(value(f.app.executeAuthor({ method: 'listReviewItems', input: { sessionId: 'other-session' } }))).toEqual([]);
});
