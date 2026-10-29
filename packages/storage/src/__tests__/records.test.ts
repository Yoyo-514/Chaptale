import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { groupRecords } from '@chaptale/creation/contracts';
import type {
  AgentWriteResult,
  CreationResult,
  DecideReviewInput,
  PendingChange,
  RecordFields,
  StoryRecord
} from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

function resource(fixture: Fixture, title: string) {
  return value(
    fixture.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title,
        format: 'markdown',
        content: ''
      }
    })
  );
}

function chapter(fixture: Fixture, title: string) {
  return value(
    fixture.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title,
        format: 'txt',
        content: `${title}正文`
      }
    })
  );
}

function fields(resourceIds: string[], text: string, chapterId: string | null = null): RecordFields {
  return {
    resourceIds,
    text,
    source: { kind: 'author' },
    placement: chapterId === null ? { kind: 'undetermined' } : { kind: 'chapter', chapterId },
    storyTime: ''
  };
}

function create(fixture: Fixture, record: RecordFields): StoryRecord {
  return value(
    fixture.app.executeAuthor({
      method: 'createRecord',
      input: { commandId: randomUUID(), workId: fixture.work.id, ...record }
    })
  );
}

function records(fixture: Fixture): StoryRecord[] {
  const snapshot = value(fixture.app.executeAuthor({ method: 'snapshot', input: { workId: fixture.work.id } }));
  if (snapshot.kind !== 'work') throw new Error('预期作品快照');
  return snapshot.records;
}

function pendingOf(result: CreationResult<AgentWriteResult>): PendingChange {
  const written = value(result);
  if (written.kind !== 'pending') throw new Error('预期生成待接受修改');
  return written.change;
}

function decide(fixture: Fixture, change: PendingChange, decision: 'accept' | 'reject') {
  const view = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  return fixture.app.executeAuthor({
    method: 'decideReview',
    input: { commandId: randomUUID(), ...target(view), decision }
  });
}

function pending(fixture: Fixture): PendingChange[] {
  return value(
    fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: fixture.work.id, sessionId: null } })
  );
}

/** Agent 在审阅模式下从序章提取：新建资料，再写一条涉及它和已有资料的事件。 */
function extract(fixture: Fixture, existingId: string, text: string) {
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
  const record = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        resourceIds: [existingId, created.targetId],
        text,
        source: { kind: 'chapter', chapterId: fixture.document.id, revisionId: fixture.document.revisionId },
        placement: { kind: 'chapter', chapterId: fixture.document.id },
        storyTime: '',
        basis: '将军守城。'
      }
    })
  );
  return { created, record };
}

it('作者新建、修改、调整顺序的事件重开后保留，多份资料共享同一事件', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const lin = resource(fixture, '林婉');
  const first = create(fixture, fields([shen.id], '拜入青云门', fixture.document.id));
  const wedding = create(fixture, fields([lin.id, shen.id], '林婉嫁给沈霁', fixture.document.id));
  const injured = create(fixture, fields([shen.id], '断了左臂', fixture.document.id));
  expect([first, wedding, injured].map(record => record.position)).toEqual([0, 1, 2]);
  expect(wedding.resourceIds).toEqual([lin.id, shen.id]);

  const moved = value(
    fixture.app.executeAuthor({
      method: 'moveRecord',
      input: { commandId: randomUUID(), workId: fixture.work.id, recordId: injured.id, beforeId: first.id }
    })
  );
  expect(moved.position).toBe(0);
  const updated = value(
    fixture.app.executeAuthor({
      method: 'updateRecord',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        recordId: first.id,
        expectedRevisionId: first.revisionId,
        ...fields([shen.id], '拜入青云门', null),
        placement: { kind: 'opening' },
        storyTime: '  景和元年 '
      }
    })
  );
  expect(updated).toMatchObject({ placement: { kind: 'opening' }, storyTime: '景和元年', position: 0 });
  const stale = fixture.app.executeAuthor({
    method: 'updateRecord',
    input: {
      commandId: randomUUID(),
      workId: fixture.work.id,
      recordId: first.id,
      expectedRevisionId: first.revisionId,
      ...fields([shen.id], '旧版本')
    }
  });
  expect(stale).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });

  await fixture.reopen();
  const saved = records(fixture);
  const groups = groupRecords(
    saved,
    value(fixture.app.executeAuthor({ method: 'listEntries', input: { workId: fixture.work.id } }))
  );
  expect(groups.map(group => [group.placement.kind, group.records.map(record => record.text)])).toEqual([
    ['opening', ['拜入青云门']],
    ['chapter', ['断了左臂', '林婉嫁给沈霁']]
  ]);
  expect(saved.filter(record => record.resourceIds.includes(lin.id)).map(record => record.text)).toEqual([
    '林婉嫁给沈霁'
  ]);
});

it('引用不存在的资料或章节被拒绝，事件至少涉及一份资料', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const invalid = (record: RecordFields) =>
    fixture.app.executeAuthor({
      method: 'createRecord',
      input: { commandId: randomUUID(), workId: fixture.work.id, ...record }
    });
  expect(invalid(fields([fixture.document.id], '把章节当资料'))).toMatchObject({
    ok: false,
    error: { message: '涉及的资料不存在或不是资料文档' }
  });
  expect(invalid(fields([shen.id], '   '))).toMatchObject({ ok: false, error: { message: '事件内容不能为空' } });
  expect(invalid(fields([shen.id], '去北境', shen.id))).toMatchObject({
    ok: false,
    error: { message: '发生章节不存在' }
  });
  expect(invalid({ ...fields([shen.id], '去北境'), resourceIds: [] })).toMatchObject({ ok: false });
  expect(records(fixture)).toEqual([]);
});

it('单个事件移入回收站后可整批恢复到原位置，或永久删除', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const a = create(fixture, fields([shen.id], '甲'));
  const b = create(fixture, fields([shen.id], '乙'));
  create(fixture, fields([shen.id], '丙'));
  value(
    fixture.app.executeAuthor({
      method: 'removeRecord',
      input: { commandId: randomUUID(), workId: fixture.work.id, recordId: b.id, expectedRevisionId: b.revisionId }
    })
  );
  expect(records(fixture).map(record => [record.text, record.position])).toEqual([
    ['甲', 0],
    ['丙', 1]
  ]);
  const [batch] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId: fixture.work.id } }));
  expect(batch).toMatchObject({
    entryCount: 0,
    roots: [],
    records: [{ id: b.id, text: '乙', resourceIds: [shen.id] }]
  });
  value(
    fixture.app.executeAuthor({
      method: 'restoreTrash',
      input: { commandId: randomUUID(), workId: fixture.work.id, batchId: batch!.id }
    })
  );
  expect(records(fixture).map(record => record.text)).toEqual(['甲', '乙', '丙']);

  value(
    fixture.app.executeAuthor({
      method: 'removeRecord',
      input: { commandId: randomUUID(), workId: fixture.work.id, recordId: a.id, expectedRevisionId: a.revisionId }
    })
  );
  value(
    fixture.app.executeAuthor({
      method: 'purgeTrash',
      input: { commandId: randomUUID(), workId: fixture.work.id, batchId: null }
    })
  );
  expect(value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId: fixture.work.id } }))).toEqual([]);
  expect(records(fixture).map(record => [record.text, record.position])).toEqual([
    ['乙', 0],
    ['丙', 1]
  ]);
});

it('永久删除资料只移除关联，不再涉及任何资料的事件随之删除', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const lin = resource(fixture, '林婉');
  create(fixture, fields([lin.id, shen.id], '成婚'));
  create(fixture, fields([lin.id], '迁居城北'));
  value(
    fixture.app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: fixture.work.id, entryIds: [lin.id] }
    })
  );
  expect(records(fixture)).toHaveLength(2);
  value(
    fixture.app.executeAuthor({
      method: 'purgeTrash',
      input: { commandId: randomUUID(), workId: fixture.work.id, batchId: null }
    })
  );
  expect(records(fixture).map(record => [record.text, record.resourceIds])).toEqual([['成婚', [shen.id]]]);
});

it('按进度查看只保留截至该章发生的事件和待定事件', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const second = chapter(fixture, '第二章');
  create(fixture, fields([shen.id], '第二章的事', second.id));
  create(fixture, fields([shen.id], '序章的事', fixture.document.id));
  create(fixture, fields([shen.id], '还没定'));
  const listed = (asOf: string | null) =>
    value(
      fixture.app.executeAgent(fixture.context, {
        method: 'listRecords',
        input: { workId: fixture.work.id, resourceId: shen.id, sourceId: null, asOf }
      })
    ).map(record => record.text);
  expect(listed(null)).toEqual(['序章的事', '第二章的事', '还没定']);
  expect(listed(fixture.document.id)).toEqual(['序章的事', '还没定']);
});

it('接受依赖新资料的事件时一并建立资料；拒绝新资料则拒绝依赖它的事件', async () => {
  const accepted = await application();
  const shen = resource(accepted, '沈霁');
  const first = extract(accepted, shen.id, '沈霁结识柳七');
  const listed = value(
    accepted.app.executeAgent(accepted.context, {
      method: 'listRecords',
      input: { workId: accepted.work.id, resourceId: first.created.targetId, sourceId: null, asOf: null }
    })
  );
  expect(listed.map(record => record.text)).toEqual(['沈霁结识柳七']);
  expect(records(accepted)).toEqual([]);
  expect(value(decide(accepted, first.record, 'accept'))).toMatchObject({ status: 'accepted' });
  expect(pending(accepted)).toEqual([]);
  const entries = value(accepted.app.executeAuthor({ method: 'listEntries', input: { workId: accepted.work.id } }));
  expect(entries.find(entry => entry.id === first.created.targetId)?.title).toBe('柳七');
  expect(records(accepted)[0]).toMatchObject({
    text: '沈霁结识柳七',
    resourceIds: [shen.id, first.created.targetId],
    source: { kind: 'chapter', chapterId: accepted.document.id, revisionId: accepted.document.revisionId }
  });

  const rejected = await application();
  const lin = resource(rejected, '林婉');
  const second = extract(rejected, lin.id, '林婉偶遇柳七');
  expect(value(decide(rejected, second.created, 'reject'))).toMatchObject({ status: 'rejected' });
  expect(pending(rejected)).toEqual([]);
  expect(records(rejected)).toEqual([]);
});

it('改为关联已有资料后事件候选指向所选资料，新资料候选被拒绝', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const qi = resource(fixture, '柳七娘');
  const { created, record } = extract(fixture, shen.id, '沈霁结识柳七');
  const relinked = value(
    fixture.app.executeAuthor({
      method: 'relinkResource',
      input: { commandId: randomUUID(), changeId: created.id, expectedVersion: created.version, resourceId: qi.id }
    })
  );
  expect(relinked.status).toBe('rejected');
  const [left] = pending(fixture);
  expect(left).toMatchObject({ id: record.id, authorEdited: true, candidate: { resourceIds: [shen.id, qi.id] } });
  expect(value(decide(fixture, left!, 'accept'))).toMatchObject({ status: 'accepted' });
  expect(records(fixture)[0]!.resourceIds).toEqual([shen.id, qi.id]);
});

it('资料进入回收站时拒绝涉及它的事件候选，Agent 撤回新资料时一并撤回依赖事件', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const lin = resource(fixture, '林婉');
  const record = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        ...fields([lin.id], '迁居城北'),
        basis: ''
      }
    })
  );
  value(
    fixture.app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: fixture.work.id, entryIds: [lin.id] }
    })
  );
  expect(pending(fixture).some(change => change.id === record.id)).toBe(false);

  const { created } = extract(fixture, shen.id, '沈霁结识柳七');
  const withdrawn = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'deleteEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        entryId: created.targetId,
        expectedRevisionId: created.version
      }
    })
  );
  expect(withdrawn.kind).toBe('withdrawn');
  expect(pending(fixture)).toEqual([]);
});

it('事件候选修改后需重新审阅；正式稿同字段被改则记为冲突', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const official = create(fixture, fields([shen.id], '断了左臂'));
  const change = pendingOf(
    fixture.app.executeAgent(fixture.context, {
      method: 'updateRecord',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        recordId: official.id,
        expectedRevisionId: official.revisionId,
        ...fields([shen.id], '断了右臂'),
        basis: '右臂'
      }
    })
  );
  expect(change).toMatchObject({ target: 'record', basis: '右臂', base: { text: '断了左臂' } });
  value(
    fixture.app.executeAuthor({
      method: 'updateRecord',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        recordId: official.id,
        expectedRevisionId: official.revisionId,
        ...fields([shen.id], '断了左腿')
      }
    })
  );
  const view = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
  expect(view.conflicts).toEqual([{ field: 'text', base: '断了左臂', current: '断了左腿', proposed: '断了右臂' }]);
  expect(decide(fixture, change, 'accept')).toMatchObject({
    ok: false,
    error: { message: '请先处理冲突，再接受修改' }
  });
  const edited = value(
    fixture.app.executeAuthor({
      method: 'updateRecordReview',
      input: { commandId: randomUUID(), ...target(view), ...fields([shen.id], '断了右腿'), resolveConflicts: true }
    })
  );
  expect(value(decide(fixture, edited, 'accept'))).toMatchObject({ status: 'accepted' });
  expect(records(fixture)[0]!.text).toBe('断了右腿');
});

it('接受依赖新资料的事件后本机进度失败，重启凭回执补齐资料与事件的进度', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  const { created, record } = extract(fixture, shen.id, '沈霁结识柳七');
  const view = value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: record.id } }));
  const input: DecideReviewInput = { commandId: randomUUID(), ...target(view), decision: 'accept' };
  const fault = new Database(join(fixture.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '审阅进度故障'); END"
    );
    expect(fixture.app.executeAuthor({ method: 'decideReview', input })).toMatchObject({
      ok: false,
      error: { message: '审阅进度故障' }
    });
    expect(records(fixture)).toHaveLength(1);
    fault.exec('DROP TRIGGER fail_progress');
    await fixture.reopen();
    const statuses = [created.id, record.id].map(
      id => value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId: id } })).change.status
    );
    expect(statuses).toEqual(['accepted', 'accepted']);
    expect(value(fixture.app.executeAuthor({ method: 'decideReview', input })).status).toBe('accepted');
    expect(records(fixture)).toHaveLength(1);
  } finally {
    fault.close();
  }
});

it('整组接受按写入顺序先建资料再写事件，作品提交与回执在一个事务中', async () => {
  const fixture = await application();
  const shen = resource(fixture, '沈霁');
  extract(fixture, shen.id, '沈霁结识柳七');
  const [summary] = value(
    fixture.app.executeAuthor({ method: 'listDeliveries', input: { sessionId: fixture.context.sessionId } })
  );
  expect(summary!.items.map(item => item.kind)).toEqual(['document', 'record']);
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
  expect(pending(fixture)).toEqual([]);
  expect(records(fixture)[0]!.resourceIds).toHaveLength(2);
  const contents = value(
    fixture.app.executeAuthor({ method: 'readDeliveryContents', input: { groupId: summary!.group.id } })
  );
  expect(contents.map(content => [content.target, content.decision])).toEqual([
    ['entry', 'accepted'],
    ['record', 'accepted']
  ]);
});
