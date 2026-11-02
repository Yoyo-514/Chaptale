import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { PendingChange } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

/** 审阅模式：Agent 改写序章后，按读到的候选版本写一条出自本章的事件。 */
async function drafted() {
  const fixture = await application();
  const workId = fixture.work.id;
  const gu = value(
    fixture.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '顾长风',
        format: 'txt',
        content: ''
      }
    })
  );
  const chapter = fixture.propose('将军守城。\n公主远行。\n城破。');
  const seen = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'readDocument',
      input: { workId, documentId: fixture.document.id }
    })
  );
  const written = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [gu.id],
        text: '城破',
        source: { kind: 'chapter', chapterId: fixture.document.id, revisionId: seen.revisionId },
        placement: { kind: 'chapter', chapterId: fixture.document.id },
        storyTime: '',
        basis: '城破。'
      }
    })
  );
  if (written.kind !== 'pending') throw new Error('预期生成待接受修改');
  return { fixture, workId, chapter, record: written.change };
}

function decide(fixture: Fixture, change: PendingChange, decision: 'accept' | 'reject') {
  const view = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  return fixture.app.executeAuthor({
    method: 'decideReview',
    input: { commandId: randomUUID(), ...target(view), decision }
  });
}

function records(fixture: Fixture) {
  const result = value(fixture.app.executeAuthor({ method: 'snapshot', input: { workId: fixture.work.id } }));
  if (result.kind !== 'work') throw new Error('预期作品快照');
  return result.records;
}

it('出处可指向本会话待审正文；正文未接受时不能接受事件，接受正文后事件绑定新修订且不待复核', async () => {
  const { fixture, workId, chapter, record } = await drafted();
  expect(decide(fixture, record, 'accept')).toMatchObject({ ok: false, error: { message: '请先处理本章正文' } });

  value(decide(fixture, chapter, 'accept'));
  value(decide(fixture, record, 'accept'));
  const [saved] = records(fixture);
  expect(saved!.source).toEqual({
    kind: 'chapter',
    chapterId: fixture.document.id,
    revisionId: fixture.read().revisionId
  });
  expect(value(fixture.app.executeAuthor({ method: 'listSourceReviews', input: { workId } }))).toEqual([]);
});

it('整组接受时正文先写入，事件出处绑定同一事务中的新修订', async () => {
  const { fixture } = await drafted();
  const group = value(
    fixture.app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: fixture.context.sessionId } })
  )!.group;
  const views = group.changeIds.map(changeId =>
    value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId } }))
  );
  value(
    fixture.app.executeAuthor({
      method: 'decideDelivery',
      input: {
        commandId: randomUUID(),
        groupId: group.id,
        workId: fixture.work.id,
        decision: 'accept',
        targets: views.map(target)
      }
    })
  );
  expect(records(fixture)[0]!.source).toMatchObject({ revisionId: fixture.read().revisionId });
});

it('正文整篇被拒绝时，出处指向它的事件候选一并拒绝，续跑结果为作者拒绝了来源正文', async () => {
  const { fixture, chapter, record } = await drafted();
  value(decide(fixture, chapter, 'reject'));
  expect(
    value(
      fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: fixture.work.id, sessionId: null } })
    )
  ).toEqual([]);
  const group = value(
    fixture.app.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: fixture.context.sessionId } })
  );
  const contents = value(
    fixture.app.executeAuthor({ method: 'readDeliveryContents', input: { groupId: group!.group.id } })
  );
  expect(contents).toEqual(
    expect.arrayContaining([expect.objectContaining({ targetId: record.targetId, decision: 'sourceRejected' })])
  );
});
