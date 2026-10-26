import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { application, target, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

function review(fixture: Fixture, changeId: string) {
  return value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId } }));
}
function decideTitle(fixture: Fixture, changeId: string, decision: 'accept' | 'reject') {
  return fixture.app.executeAuthor({
    method: 'decideReview',
    input: { commandId: randomUUID(), ...target(review(fixture, changeId)), decision, part: 'title' }
  });
}

it('单独接受改名只提交标题，正文修改继续待审；重复命令沿用回执', async () => {
  const fixture = await application();
  const change = fixture.propose('将军出征。\n公主远行。', '出征');
  const input = {
    commandId: randomUUID(),
    ...target(review(fixture, change.id)),
    decision: 'accept' as const,
    part: 'title' as const
  };
  const decided = value(fixture.app.executeAuthor<'decideReview'>({ method: 'decideReview', input }));
  expect(decided.status).toBe('pending');
  expect(fixture.read()).toMatchObject({ title: '出征', content: '将军守城。\n公主远行。' });
  expect(review(fixture, change.id).candidate).toMatchObject({ title: '出征', content: '将军出征。\n公主远行。' });
  const revisionId = fixture.read().revisionId;
  expect(value(fixture.app.executeAuthor<'decideReview'>({ method: 'decideReview', input }))).toEqual(decided);
  expect(fixture.read().revisionId).toBe(revisionId);

  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(review(fixture, change.id)), decision: 'accept' }
    })
  );
  expect(fixture.read()).toMatchObject({ title: '出征', content: '将军出征。\n公主远行。' });
});

it('保留原标题只撤回改名；候选只剩改名时拒绝即结束', async () => {
  const fixture = await application();
  const change = fixture.propose('将军出征。\n公主远行。', '出征');
  expect(value(decideTitle(fixture, change.id, 'reject')).status).toBe('pending');
  expect(review(fixture, change.id).candidate).toMatchObject({ title: '序章', content: '将军出征。\n公主远行。' });
  expect(fixture.read().title).toBe('序章');

  const renamed = await application();
  const only = renamed.propose('将军守城。\n公主远行。', '出征');
  expect(value(decideTitle(renamed, only.id, 'reject')).status).toBe('rejected');
  expect(renamed.read().title).toBe('序章');
  expect(decideTitle(renamed, only.id, 'accept')).toMatchObject({ ok: false });
});

it('标题冲突时不能单独接受改名，没有改名的修改不能按标题决定', async () => {
  const fixture = await application();
  const change = fixture.propose('将军出征。\n公主远行。', '出征');
  const current = fixture.read();
  value(
    fixture.app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        documentId: fixture.document.id,
        expectedRevisionId: current.revisionId,
        title: '归来',
        format: current.format,
        content: current.content
      }
    })
  );
  expect(decideTitle(fixture, change.id, 'accept')).toMatchObject({
    ok: false,
    error: { message: '标题有冲突，请先处理冲突再接受改名' }
  });
  expect(fixture.read().title).toBe('归来');

  const plain = await application();
  const body = plain.propose('将军出征。\n公主远行。');
  expect(decideTitle(plain, body.id, 'accept')).toMatchObject({
    ok: false,
    error: { message: '这项修改没有改名可单独处理' }
  });
});
