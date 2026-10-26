import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type { CreationApplication } from '@chaptale/creation/application';

import { application, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

function createNote(fixture: Fixture, title: string, content: string) {
  const result = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title,
        format: 'markdown',
        content
      }
    })
  );
  if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
  return result.change;
}
function deliveries(app: CreationApplication, sessionId: string) {
  return value(app.executeAuthor({ method: 'listDeliveries', input: { sessionId } }));
}
function decideAll(fixture: Fixture, decision: 'accept' | 'reject', commandId = randomUUID()) {
  const [summary] = deliveries(fixture.app, fixture.context.sessionId);
  return fixture.app.executeAuthor({
    method: 'decideDelivery',
    input: {
      commandId,
      groupId: summary.group.id,
      workId: fixture.work.id,
      decision,
      targets: summary.items.map(item => item.target)
    }
  });
}

it('整组接受在同一事务写入正文与新资料，重复命令沿用回执且之后自动归入新组', async () => {
  const fixture = await application();
  fixture.propose('将军出征。\n公主远行。');
  const note = createNote(fixture, '人物', '将军决定出征。');
  const [summary] = deliveries(fixture.app, fixture.context.sessionId);
  expect(summary.items.map(item => [item.title, item.created])).toEqual([
    ['序章', false],
    ['人物', true]
  ]);
  const commandId = randomUUID();
  const accepted = value(decideAll(fixture, 'accept', commandId));
  expect(fixture.read().content).toBe('将军出征。\n公主远行。');
  const saved = value(
    fixture.app.executeAuthor({ method: 'readDocument', input: { workId: fixture.work.id, documentId: note.entryId } })
  );
  expect(saved.content).toBe('将军决定出征。');
  expect(value(fixture.app.executeAuthor({ method: 'readDeliveryGroup', input: { groupId: accepted.id } }))).toEqual({
    group: accepted,
    pendingCount: 0
  });
  expect(
    value(
      fixture.app.executeAuthor({
        method: 'decideDelivery',
        input: {
          commandId,
          groupId: summary.group.id,
          workId: fixture.work.id,
          decision: 'accept',
          targets: summary.items.map(item => item.target)
        }
      })
    )
  ).toEqual(accepted);
});

it('任一修改冲突或已变化时整组接受整体拒绝，正式稿与其他候选保持原状；整组拒绝不受冲突限制', async () => {
  const fixture = await application();
  fixture.propose('将军出征。\n公主远行。');
  createNote(fixture, '人物', '将军决定出征。');
  fixture.save('将军回城。\n公主远行。');
  const before = deliveries(fixture.app, fixture.context.sessionId)[0];
  expect(before.items.find(item => item.title === '序章')!.conflicted).toBe(true);
  const conflict = decideAll(fixture, 'accept');
  expect(conflict).toMatchObject({ ok: false, error: { message: expect.stringContaining('《序章》') } });
  expect(fixture.read().content).toBe('将军回城。\n公主远行。');
  expect(fixture.app.executeAuthor({ method: 'listEntries', input: { workId: fixture.work.id } })).toMatchObject({
    ok: true,
    value: [expect.objectContaining({ title: '序章' })]
  });

  const stale = fixture.app.executeAuthor({
    method: 'decideDelivery',
    input: {
      commandId: randomUUID(),
      groupId: before.group.id,
      workId: fixture.work.id,
      decision: 'reject',
      targets: before.items.slice(0, 1).map(item => item.target)
    }
  });
  expect(stale).toMatchObject({ ok: false, error: { message: '待审修改已变化，请刷新后处理' } });

  value(decideAll(fixture, 'reject'));
  expect(deliveries(fixture.app, fixture.context.sessionId)).toEqual([
    { group: expect.objectContaining({ id: before.group.id, status: 'pending' }), items: [] }
  ]);
});

it('作品库提交成功、本机进度中断后，重开按回执补齐整组接受进度且不重复写入', async () => {
  const fixture = await application();
  fixture.propose('将军出征。\n公主远行。');
  const note = createNote(fixture, '人物', '将军决定出征。');
  const [summary] = deliveries(fixture.app, fixture.context.sessionId);
  const input = {
    commandId: randomUUID(),
    groupId: summary.group.id,
    workId: fixture.work.id,
    decision: 'accept' as const,
    targets: summary.items.map(item => item.target)
  };
  const fault = new Database(join(fixture.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(fixture.app.executeAuthor({ method: 'decideDelivery', input })).toMatchObject({
      ok: false,
      error: { message: '审阅进度故障' }
    });
    const saved = fixture.read();
    expect(saved.content).toBe('将军出征。\n公主远行。');
    fault.exec('DROP TRIGGER fail_progress');
    await fixture.reopen();
    expect(deliveries(fixture.app, fixture.context.sessionId)[0].items).toEqual([]);
    expect(value(fixture.app.executeAuthor({ method: 'decideDelivery', input })).id).toBe(summary.group.id);
    expect(fixture.read()).toEqual(saved);
    const entries = value(fixture.app.executeAuthor({ method: 'listEntries', input: { workId: fixture.work.id } }));
    expect(entries.filter(entry => entry.id === note.entryId)).toHaveLength(1);
  } finally {
    fault.close();
  }
});

it('结束当前任务后剩余候选转为历史待审，新写入另开新组，改动历史待审条目被拒绝', async () => {
  const fixture = await application();
  const { app, context, work } = fixture;
  const change = fixture.propose('将军出征。\n公主远行。');
  const group = value(
    app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } })
  )!.group;
  const progress = {
    commandId: randomUUID(),
    sessionId: context.sessionId,
    groupId: group.id,
    expectedVersion: group.version
  };
  const ended = value(app.executeAuthor({ method: 'endDelivery', input: progress }));
  expect(ended.status).toBe('ended');
  expect(value(app.executeAuthor({ method: 'endDelivery', input: progress }))).toEqual(ended);
  expect(value(app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } }))).toBe(
    null
  );

  const rewrite = app.executeAgent(context, {
    method: 'writeContent',
    input: {
      commandId: randomUUID(),
      workId: work.id,
      documentId: fixture.document.id,
      expectedRevisionId: fixture.document.revisionId,
      content: '将军回城。'
    }
  });
  expect(rewrite).toMatchObject({ ok: false, error: { message: '该条目有早前任务的待接受修改，请作者先处理' } });
  const direct = app.executeAgent(
    { ...context, mode: 'direct' },
    {
      method: 'writeContent',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: fixture.document.id,
        expectedRevisionId: fixture.document.revisionId,
        content: '将军回城。'
      }
    }
  );
  expect(direct).toMatchObject({ ok: false, error: { message: '该条目有早前任务的待接受修改，请作者先处理' } });

  const note = createNote(fixture, '人物', '将军决定出征。');
  const [current, history] = deliveries(app, context.sessionId);
  expect(current.group).toMatchObject({ status: 'pending', changeIds: [note.id] });
  expect(current.group.id).not.toBe(group.id);
  expect(history.group).toMatchObject({ id: group.id, status: 'ended' });
  expect(history.items.map(item => item.target.changeId)).toEqual([change.id]);

  value(
    app.executeAuthor({
      method: 'decideDelivery',
      input: {
        commandId: randomUUID(),
        groupId: history.group.id,
        workId: work.id,
        decision: 'accept',
        targets: history.items.map(item => item.target)
      }
    })
  );
  expect(fixture.read().content).toBe('将军出征。\n公主远行。');
  expect(deliveries(app, context.sessionId).map(summary => summary.group.id)).toEqual([current.group.id]);
});
