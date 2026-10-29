import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

it('作者改动与 Agent 改动不重叠时三方合并，接受以最新正式修订为父修订', async () => {
  const fixture = await application();
  const { app, work, propose, save } = fixture;
  const change = propose('将军出征。\n公主远行。');
  const latest = save('将军守城。\n公主回城。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect((view.candidate as EntrySnapshot).content).toBe('将军出征。\n公主回城。');
  expect(view.conflicts).toEqual([]);
  expect(fixture.read().content).toBe('将军守城。\n公主回城。');
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  );
  expect(fixture.read().content).toBe('将军出征。\n公主回城。');
  expect(
    value(
      app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: fixture.read().revisionId } })
    ).parentRevisionId
  ).toBe(latest.revisionId);
});

it('重叠改动保留双方，作者解决冲突产生新候选，迟到接受和 Agent 覆盖都被拒绝', async () => {
  const fixture = await application();
  const { app, work, document, context, propose, save } = fixture;
  const change = propose('将军出征。\n公主远行。');
  save('将军巡城。\n公主远行。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect(view.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'content' })]));
  expect(view.conflicts.map(item => item.current).join('')).toContain('巡');
  expect(view.conflicts.map(item => item.proposed).join('')).toContain('出');
  expect(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  ).toMatchObject({ ok: false });
  const updated = value(
    app.executeAuthor({
      method: 'updateReview',
      input: {
        commandId: randomUUID(),
        ...target(view),
        title: '序章',
        content: '将军再次出征。\n公主远行。',
        resolveConflicts: true
      }
    })
  );
  expect(updated.version).not.toBe(view.change.version);
  expect((updated.candidate as EntrySnapshot).wordCount).toBe(10);
  expect(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  ).toMatchObject({ ok: false, error: { message: '待接受修改已有新版本，请刷新后审阅' } });
  expect(
    app.executeAgent(context, {
      method: 'editDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: document.id,
        expectedRevisionId: (updated.candidate as EntrySnapshot).revisionId,
        oldText: '再次',
        newText: '终于'
      }
    })
  ).toMatchObject({ ok: false, error: { message: '作者正在审阅或手改此候选，请等待作者处理后再修改' } });
  const resolved = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect(resolved.conflicts).toEqual([]);
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(resolved), decision: 'accept' }
    })
  );
  expect(fixture.read().content).toBe('将军再次出征。\n公主远行。');
});

it('逐块接受只修改选中部分，剩余候选可拒绝，正式修订和已接受部分保留', async () => {
  const fixture = await application();
  const { app, propose } = fixture;
  const change = propose('将军出征。\n公主回城。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  const accepted = value(
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
  expect(accepted.status).toBe('pending');
  const official = fixture.read();
  expect(official.content).toBe('将军出征。\n公主远行。');
  const rest = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect((rest.candidate as EntrySnapshot).content).toBe('将军出征。\n公主回城。');
  expect(rest.conflicts).toEqual([]);
  value(
    app.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        ...target(rest),
        decision: 'reject',
        range: { fromA: 8, toA: 10, fromB: 8, toB: 10 }
      }
    })
  );
  expect(fixture.read()).toEqual(official);
  expect(value(app.executeAuthor({ method: 'listPendingChanges', input: { workId: null, sessionId: null } }))).toEqual(
    []
  );
});

it('打开审阅后正式正文又变化时，迟到决定保留作者的新修订', async () => {
  const fixture = await application();
  const { app, propose, save } = fixture;
  const change = propose('将军出征。\n公主远行。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  const saved = save('将军守城。\n公主回城。');
  expect(
    app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  ).toMatchObject({ ok: false, error: { message: '正式内容已有变化，请刷新审阅内容' } });
  expect(fixture.read().revisionId).toBe(saved.revisionId);
});
