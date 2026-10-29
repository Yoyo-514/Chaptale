import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

it('改稿自动归集，跨重启保留，作者处理全部修改后直接继续，重试沿用回执', async () => {
  const fixture = await application();
  const { context } = fixture;
  const change = fixture.propose('将军出征。\n公主远行。');
  const current = () =>
    value(fixture.app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } }));
  const group = current()!.group;
  expect(group.status).toBe('pending');
  expect(group.changeIds).toEqual([change.id]);
  expect(current()!.pendingCount).toBe(1);
  await fixture.reopen();
  expect(current()).toEqual({ group, pendingCount: 1 });
  const command = {
    method: 'continueDelivery' as const,
    input: {
      commandId: randomUUID(),
      sessionId: context.sessionId,
      groupId: group.id,
      expectedVersion: group.version
    }
  };
  expect(fixture.app.executeAuthor(command)).toMatchObject({ ok: false });
  const review = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(review), decision: 'accept' }
    })
  );
  const continued = value(fixture.app.executeAuthor(command));
  expect(continued.status).toBe('continued');
  expect(value(fixture.app.executeAuthor(command))).toEqual(continued);
  expect(fixture.read().content).toBe('将军出征。\n公主远行。');
  await fixture.reopen();
  expect(current()).toEqual({ group: continued, pendingCount: 0 });
});

it('正文与资料共同待审，部分接受保持等待，继续读取作者实际接受的正式内容', async () => {
  const fixture = await application();
  const { app, context, work } = fixture;
  const body = fixture.propose('将军出征。\n公主回宫。');
  const note = value(
    app.executeAgent(context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '人物',
        format: 'markdown',
        content: '将军决定出征。'
      }
    })
  );
  if (note.kind !== 'pending') throw new Error('预期生成资料候选');
  const group = value(
    app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } })
  )!.group;
  expect(group.changeIds).toEqual([body.id, note.change.id]);
  const command = {
    method: 'continueDelivery' as const,
    input: {
      commandId: randomUUID(),
      sessionId: context.sessionId,
      groupId: group.id,
      expectedVersion: group.version
    }
  };
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: body.id } }));
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        ...target(view),
        decision: 'accept',
        range: { fromA: 2, toA: 4, fromB: 2, toB: 4 }
      }
    })
  );
  expect(app.executeAuthor(command)).toMatchObject({ ok: false });
  for (const [changeId, decision] of [
    [body.id, 'reject'],
    [note.change.id, 'accept']
  ] as const) {
    const current = value(app.executeAuthor({ method: 'readReview', input: { changeId } }));
    value(
      app.executeAuthor({ method: 'decideReview', input: { commandId: randomUUID(), ...target(current), decision } })
    );
  }
  value(app.executeAuthor(command));
  const contents = value(app.executeAuthor({ method: 'readDeliveryContents', input: { groupId: group.id } }));
  expect(contents.map(item => (item.snapshot as EntrySnapshot | null)?.content)).toEqual([
    '将军出征。\n公主远行。',
    '将军决定出征。'
  ]);
});

it('继续前补改沿用当前组并更新版本，迟到的继续请求保留新修改', async () => {
  const fixture = await application();
  const { app, context, work, document } = fixture;
  const first = fixture.propose('第一次改稿');
  const before = value(
    app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } })
  )!.group;
  const second = value(
    app.executeAgent(context, {
      method: 'writeContent',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: document.id,
        expectedRevisionId: first.version,
        content: '问答后的补改'
      }
    })
  );
  expect(second.kind).toBe('pending');
  const after = value(app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } }))!;
  expect(after.group.id).toBe(before.id);
  expect(after.group.version).not.toBe(before.version);
  expect(after.group.changeIds).toEqual([first.id]);
  expect(after.pendingCount).toBe(1);
  const review = value(app.executeAuthor({ method: 'readReview', input: { changeId: first.id } }));
  expect((review.candidate as EntrySnapshot).content).toBe('问答后的补改');
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(review), decision: 'reject' }
    })
  );
  expect(
    app.executeAuthor({
      method: 'continueDelivery',
      input: {
        commandId: randomUUID(),
        sessionId: context.sessionId,
        groupId: before.id,
        expectedVersion: before.version
      }
    })
  ).toMatchObject({ ok: false });
  value(
    app.executeAuthor({
      method: 'continueDelivery',
      input: {
        commandId: randomUUID(),
        sessionId: context.sessionId,
        groupId: after.group.id,
        expectedVersion: after.group.version
      }
    })
  );
  const next = fixture.propose('下一章改稿');
  const current = value(app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: context.sessionId } }))!;
  expect(current.group.id).not.toBe(before.id);
  expect(current.group.changeIds).toEqual([next.id]);
});

it('其他会话的历史改稿独立保留，直接修改使用正式稿，重复写入返回原回执', async () => {
  const fixture = await application();
  const { app, context, work, document } = fixture;
  const old = fixture.propose('旧任务改稿');
  const other = { sessionId: randomUUID(), mode: 'direct' as const };
  const command = {
    method: 'editDocument' as const,
    input: {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      oldText: '守城',
      newText: '驻城'
    }
  };
  expect(value(app.executeAgent(other, command)).kind).toBe('saved');
  expect(value(app.executeAgent(other, command)).kind).toBe('saved');
  expect(fixture.read().content).toBe('将军驻城。\n公主远行。');
  expect(
    value(app.executeAuthor({ method: 'listPendingChanges', input: { workId: work.id, sessionId: context.sessionId } }))
  ).toEqual([old]);
  expect(value(app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: other.sessionId } }))).toBeNull();
});
