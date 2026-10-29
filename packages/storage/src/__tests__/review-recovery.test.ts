import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';
import type { DecideReviewInput } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

it.each([false, true])('正式修订提交后本机进度失败，重启凭回执恢复；逐块=%s', async partial => {
  const fixture = await application();
  const { app, rootDir, work, document, propose } = fixture;
  const change = propose(partial ? '公主回城。' : '将军出征。\n公主远行。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  const input: DecideReviewInput = {
    commandId: randomUUID(),
    ...target(view),
    decision: 'accept',
    ...(partial ? { range: { fromA: 0, toA: 6, fromB: 0, toB: 0 } } : {})
  };
  const fault = new Database(join(rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(app.executeAuthor({ method: 'decideReview', input })).toMatchObject({
      ok: false,
      error: { message: '审阅进度故障' }
    });
    const saved = fixture.read();
    expect(saved.content).toBe(partial ? '公主远行。' : '将军出征。\n公主远行。');
    fault.exec('DROP TRIGGER fail_progress');
    await fixture.reopen();
    const pending = value(
      fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: work.id, sessionId: null } })
    );
    expect(pending).toHaveLength(partial ? 1 : 0);
    if (partial) expect((pending[0]!.candidate as EntrySnapshot).content).toBe('公主回城。');
    const retried = value(fixture.app.executeAuthor<'decideReview'>({ method: 'decideReview', input }));
    expect(retried.status).toBe(partial ? 'pending' : 'accepted');
    expect(fixture.read()).toEqual(saved);
    expect(
      value(
        fixture.app.executeAuthor({ method: 'readRevision', input: { workId: work.id, revisionId: saved.revisionId } })
      ).parentRevisionId
    ).toBe(document.revisionId);
  } finally {
    fault.close();
  }
});

it('作品提交失败后重启只保留候选，不恢复尚未执行的接受动作', async () => {
  const fixture = await application();
  const { app, rootDir, work, propose } = fixture;
  const before = fixture.read();
  const change = propose('将军出征。\n公主远行。');
  const view = value(app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  const fault = new Database(join(rootDir, 'works', work.id, 'work.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, '作品回执故障'); END"
    );
    expect(
      app.executeAuthor({
        method: 'decideReview',
        input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
      })
    ).toMatchObject({ ok: false, error: { message: '作品回执故障' } });
    fault.exec('DROP TRIGGER fail_receipt');
    await fixture.reopen();
    expect(
      value(fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: work.id, sessionId: null } }))
    ).toHaveLength(1);
    expect(fixture.read()).toEqual(before);
    expect(
      value(
        fixture.app.executeAuthor({
          method: 'searchDocuments',
          input: { workId: work.id, query: '出征', offset: 0, limit: 10 }
        })
      ).entries
    ).toEqual([]);
  } finally {
    fault.close();
  }
});
