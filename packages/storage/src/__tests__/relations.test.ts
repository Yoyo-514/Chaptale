import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type {
  AgentWriteResult,
  CreationResult,
  DecideReviewInput,
  MilestoneInput,
  PendingChange,
  RelationInput,
  RelationReviewView,
  StoryRelation
} from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

function entry(fixture: Fixture, section: 'resource' | 'manuscript', title: string) {
  return value(
    fixture.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section,
        kind: 'document',
        title,
        format: 'txt',
        content: `${title}正文`
      }
    })
  );
}

function at(chapterId: string | null, kind: 'start' | 'end' = 'start', id: string | null = null): MilestoneInput {
  return {
    id,
    kind,
    source: { kind: 'author' },
    placement: chapterId === null ? { kind: 'undetermined' } : { kind: 'chapter', chapterId },
    storyTime: ''
  };
}

function mentorship(resourceIds: [string, string], milestones: MilestoneInput[]): RelationInput {
  return { resourceIds, type: '师徒', directed: true, titles: ['师父', '徒弟'], milestones };
}

function create(fixture: Fixture, input: RelationInput) {
  return fixture.app.executeAuthor({
    method: 'createRelation',
    input: { commandId: randomUUID(), workId: fixture.work.id, ...input }
  });
}

function relations(fixture: Fixture): StoryRelation[] {
  const snapshot = value(fixture.app.executeAuthor({ method: 'snapshot', input: { workId: fixture.work.id } }));
  if (snapshot.kind !== 'work') throw new Error('预期作品快照');
  return snapshot.relations;
}

function pendingOf(result: CreationResult<AgentWriteResult>): PendingChange {
  const written = value(result);
  if (written.kind !== 'pending') throw new Error('预期生成待接受修改');
  return written.change;
}

function review(fixture: Fixture, change: PendingChange): RelationReviewView {
  return value(
    fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } })
  ) as RelationReviewView;
}

function decide(fixture: Fixture, change: PendingChange, decision: 'accept' | 'reject') {
  return fixture.app.executeAuthor({
    method: 'decideReview',
    input: { commandId: randomUUID(), ...target(review(fixture, change)), decision }
  });
}

function pending(fixture: Fixture): PendingChange[] {
  return value(
    fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: fixture.work.id, sessionId: null } })
  );
}

/** 两份资料与两章：沈霁、顾长风，序章、第二章。 */
async function story() {
  const fixture = await application();
  const shen = entry(fixture, 'resource', '沈霁');
  const gu = entry(fixture, 'resource', '顾长风');
  const second = entry(fixture, 'manuscript', '第二章');
  return { fixture, shen, gu, first: fixture.document, second };
}

it('作者新建、修改与删除关系，重开后保留，可从回收站恢复或永久清空', async () => {
  const { fixture, shen, gu, first, second } = await story();
  const created = value(create(fixture, mentorship([gu.id, shen.id], [at(first.id)])));
  const startId = created.milestones[0]!.id;
  const updated = value(
    fixture.app.executeAuthor({
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: created.id,
        expectedRevisionId: created.revisionId,
        ...mentorship([gu.id, shen.id], [at(first.id, 'start', startId), at(second.id, 'end')])
      }
    })
  );
  expect(updated.milestones.map(item => [item.id === startId, item.kind])).toEqual([
    [true, 'start'],
    [false, 'end']
  ]);
  await fixture.reopen();
  expect(relations(fixture)).toEqual([updated]);

  value(
    fixture.app.executeAuthor({
      method: 'removeRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: created.id,
        expectedRevisionId: updated.revisionId
      }
    })
  );
  expect(relations(fixture)).toEqual([]);
  const [batch] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId: fixture.work.id } }));
  expect(batch!.relations).toEqual([{ id: created.id, type: '师徒', resourceIds: [gu.id, shen.id] }]);
  value(
    fixture.app.executeAuthor({
      method: 'restoreTrash',
      input: { commandId: randomUUID(), workId: fixture.work.id, batchId: batch!.id }
    })
  );
  expect(relations(fixture)).toEqual([updated]);
});

it('双方须为两份不同资料、至少一条建立，同名类型方向与预设和已有关系一致', async () => {
  const { fixture, shen, gu, first } = await story();
  const failure = (input: RelationInput) => {
    const result = create(fixture, input);
    return result.ok ? null : result.error.message;
  };
  expect(failure(mentorship([shen.id, shen.id], [at(first.id)]))).toBe('关系双方不能是同一份资料');
  expect(failure(mentorship([shen.id, first.id], [at(first.id)]))).toBe('关系涉及的资料不存在或不是资料文档');
  expect(failure(mentorship([gu.id, shen.id], [at(first.id, 'end')]))).toBe('关系至少要有一条建立');
  expect(failure({ ...mentorship([gu.id, shen.id], [at(first.id)]), directed: false })).toBe(
    '关系类型“师徒”在本作品中有方向，请保持一致'
  );
  const brothers = {
    resourceIds: [gu.id, shen.id] as [string, string],
    type: '结义兄弟',
    titles: ['兄', '弟'] as [string, string]
  };
  value(create(fixture, { ...brothers, directed: false, milestones: [at(first.id)] }));
  expect(failure({ ...brothers, directed: true, milestones: [at(first.id)] })).toBe(
    '关系类型“结义兄弟”在本作品中无方向，请保持一致'
  );
  const listed = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'listRelations',
      input: { workId: fixture.work.id, resourceId: null, asOf: null }
    })
  );
  expect(listed.types.map(item => [item.type, item.directed])).toContainEqual(['结义兄弟', false]);
});

it('按进度看最近一条建立或结束，不要求交替，位置待定的不参与', async () => {
  const { fixture, shen, gu, first, second } = await story();
  value(
    create(fixture, mentorship([gu.id, shen.id], [at(first.id), at(second.id, 'end'), at(second.id), at(null, 'end')]))
  );
  value(create(fixture, { ...mentorship([shen.id, gu.id], [at(null)]), type: '敌对', directed: false }));
  const states = (asOf: string | null) =>
    value(
      fixture.app.executeAgent(fixture.context, {
        method: 'listRelations',
        input: { workId: fixture.work.id, resourceId: shen.id, asOf }
      })
    ).relations.map(relation => [relation.type, relation.state]);
  expect(states(first.id)).toEqual([
    ['师徒', 'active'],
    ['敌对', 'undetermined']
  ]);
  expect(states(null)).toEqual([
    ['师徒', 'active'],
    ['敌对', 'undetermined']
  ]);
});

it('Agent 修改只提交改动；不同会话改动不同的建立或结束时合并，改同一条记为冲突', async () => {
  const { fixture, shen, gu, first, second } = await story();
  const official = value(create(fixture, mentorship([gu.id, shen.id], [at(first.id)])));
  const startId = official.milestones[0]!.id;
  const change = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: official.id,
        expectedRevisionId: official.revisionId,
        milestones: [at(second.id, 'end')],
        basis: '从此不再以师徒相称。'
      }
    })
  );
  expect(change).toMatchObject({ target: 'relation', candidate: { type: '师徒' } });
  expect((change.candidate as StoryRelation).milestones.map(item => item.kind)).toEqual(['start', 'end']);

  // 作者在正式稿补了故事时间：只有正式稿改了这一条，合并后保留。
  const timed = value(
    fixture.app.executeAuthor({
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: official.id,
        expectedRevisionId: official.revisionId,
        ...mentorship([gu.id, shen.id], [{ ...at(first.id, 'start', startId), storyTime: '景和三年' }])
      }
    })
  );
  const merged = review(fixture, change);
  expect(merged.conflicts).toEqual([]);
  expect(merged.candidate.milestones.map(item => [item.kind, item.storyTime])).toEqual([
    ['start', '景和三年'],
    ['end', '']
  ]);

  // 另一会话改这条建立的故事时间；作者随后在正式稿把同一条改成别的时间：双方改得不同。
  const other = pendingOf(
    fixture.app.executeAgent(
      { sessionId: 'session-b', mode: 'review' },
      {
        method: 'updateRelation',
        input: {
          commandId: randomUUID(),
          workId: fixture.work.id,
          relationId: official.id,
          expectedRevisionId: timed.revisionId,
          milestones: [{ ...at(first.id, 'start', startId), storyTime: '景和四年' }],
          basis: ''
        }
      }
    )
  );
  value(decide(fixture, change, 'accept'));
  expect(review(fixture, other).conflicts).toEqual([]);
  const moved = relations(fixture)[0]!;
  value(
    fixture.app.executeAuthor({
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: official.id,
        expectedRevisionId: moved.revisionId,
        ...mentorship(
          [gu.id, shen.id],
          moved.milestones.map(item => (item.id === startId ? { ...item, storyTime: '景和二年' } : item))
        )
      }
    })
  );
  const conflicted = review(fixture, other);
  expect(conflicted.conflicts).toMatchObject([{ field: 'milestone', milestoneId: startId }]);
  expect(decide(fixture, other, 'accept')).toMatchObject({ ok: false, error: { message: '请先处理冲突，再接受修改' } });
  const resolved = value(
    fixture.app.executeAuthor({
      method: 'updateRelationReview',
      input: {
        commandId: randomUUID(),
        ...target(conflicted),
        ...mentorship([gu.id, shen.id], conflicted.candidate.milestones),
        resolveConflicts: true
      }
    })
  );
  value(decide(fixture, resolved, 'accept'));
  expect(relations(fixture)[0]!.milestones.map(item => [item.kind, item.storyTime])).toEqual([
    ['start', '景和四年'],
    ['end', '']
  ]);
});

/** Agent 在审阅模式下新建资料“柳七”，再提出它与已有资料的师徒关系。 */
function extract(fixture: Fixture, existingId: string, chapterId: string) {
  const created = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '柳七',
        format: 'markdown',
        content: '江湖客'
      }
    })
  );
  const relation = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        ...mentorship([existingId, created.targetId], [at(chapterId)]),
        basis: '收柳七为徒。'
      }
    })
  );
  return { created, relation };
}

it('接受依赖新资料的关系一并建立资料；拒绝新资料则拒绝关系；可改为关联已有资料', async () => {
  const accepted = await story();
  const first = extract(accepted.fixture, accepted.gu.id, accepted.first.id);
  value(decide(accepted.fixture, first.relation, 'accept'));
  expect(pending(accepted.fixture)).toEqual([]);
  expect(relations(accepted.fixture)[0]!.resourceIds).toEqual([accepted.gu.id, first.created.targetId]);

  const rejected = await story();
  const second = extract(rejected.fixture, rejected.gu.id, rejected.first.id);
  value(decide(rejected.fixture, second.created, 'reject'));
  expect(pending(rejected.fixture)).toEqual([]);

  const relinked = await story();
  const third = extract(relinked.fixture, relinked.gu.id, relinked.first.id);
  const relink = (resourceId: string) =>
    relinked.fixture.app.executeAuthor({
      method: 'relinkResource',
      input: { commandId: randomUUID(), changeId: third.created.id, expectedVersion: third.created.version, resourceId }
    });
  expect(relink(relinked.gu.id)).toMatchObject({
    ok: false,
    error: { message: '关系双方不能是同一份资料，请改选其他资料' }
  });
  value(relink(relinked.shen.id));
  const [left] = pending(relinked.fixture);
  expect(left).toMatchObject({ id: third.relation.id, candidate: { resourceIds: [relinked.gu.id, relinked.shen.id] } });
});

it('资料进回收站时拒绝涉及它的关系候选、保留正式关系；永久清空资料时删除涉及它的关系', async () => {
  const { fixture, shen, gu, first } = await story();
  const official = value(create(fixture, mentorship([gu.id, shen.id], [at(first.id)])));
  const change = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        relationId: official.id,
        expectedRevisionId: official.revisionId,
        titles: ['师尊', '徒弟'],
        milestones: [],
        basis: ''
      }
    })
  );
  value(
    fixture.app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: fixture.work.id, entryIds: [gu.id] }
    })
  );
  expect(pending(fixture).some(item => item.id === change.id)).toBe(false);
  expect(relations(fixture)).toEqual([official]);
  const [batch] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId: fixture.work.id } }));
  value(
    fixture.app.executeAuthor({
      method: 'purgeTrash',
      input: { commandId: randomUUID(), workId: fixture.work.id, batchId: batch!.id }
    })
  );
  expect(relations(fixture)).toEqual([]);
});

it('接受依赖新资料的关系后本机进度失败，重启凭回执补齐进度', async () => {
  const { fixture, gu, first } = await story();
  const { created, relation } = extract(fixture, gu.id, first.id);
  const input: DecideReviewInput = {
    commandId: randomUUID(),
    ...target(review(fixture, relation)),
    decision: 'accept'
  };
  const fault = new Database(join(fixture.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(fixture.app.executeAuthor({ method: 'decideReview', input })).toMatchObject({
      ok: false,
      error: { message: '审阅进度故障' }
    });
    expect(relations(fixture)).toHaveLength(1);
    fault.exec('DROP TRIGGER fail_progress');
    await fixture.reopen();
    const statuses = [created.id, relation.id].map(
      id => value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: id } })).change.status
    );
    expect(statuses).toEqual(['accepted', 'accepted']);
    expect(relations(fixture)).toHaveLength(1);
  } finally {
    fault.close();
  }
});

it('整组接受先建资料再写关系，交付内容与审阅条目包含关系', async () => {
  const { fixture, gu, first } = await story();
  extract(fixture, gu.id, first.id);
  const [summary] = value(
    fixture.app.executeAuthor({ method: 'listDeliveries', input: { sessionId: fixture.context.sessionId } })
  );
  expect(summary!.items.map(item => item.kind)).toEqual(['document', 'relation']);
  value(
    fixture.app.executeAuthor({
      method: 'decideDelivery',
      input: {
        commandId: randomUUID(),
        groupId: summary!.group.id,
        workId: fixture.work.id,
        decision: 'accept',
        targets: summary!.items.map(item => item.target)
      }
    })
  );
  expect(relations(fixture)).toHaveLength(1);
  const contents = value(
    fixture.app.executeAuthor({ method: 'readDeliveryContents', input: { groupId: summary!.group.id } })
  );
  expect(contents.map(content => [content.target, content.decision])).toEqual([
    ['entry', 'accepted'],
    ['relation', 'accepted']
  ]);
});
