import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import type { Entry, RecordSource } from '@chaptale/creation/contracts';

import { application, value } from './fixtures/review.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

async function story() {
  const fixture = await application();
  const workId = fixture.work.id;
  const entry = (section: 'resource' | 'manuscript', title: string) =>
    value(
      fixture.app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section,
          kind: 'document',
          title,
          format: 'txt',
          content: `${title}正文`
        }
      })
    );
  const gu = entry('resource', '顾长风');
  const lin = entry('resource', '林晚');
  const chapter = fixture.document;
  const from = (entry: Entry): RecordSource => ({ kind: 'chapter', chapterId: entry.id, revisionId: entry.revisionId });
  const record = value(
    fixture.app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [gu.id],
        text: '顾长风守城',
        source: from(chapter),
        placement: { kind: 'chapter', chapterId: chapter.id },
        storyTime: ''
      }
    })
  );
  const relation = value(
    fixture.app.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [gu.id, lin.id],
        type: '师徒',
        directed: true,
        titles: ['师父', '徒弟'],
        milestones: [
          {
            id: null,
            kind: 'start',
            source: from(chapter),
            placement: { kind: 'chapter', chapterId: chapter.id },
            storyTime: ''
          },
          { id: null, kind: 'end', source: { kind: 'author' }, placement: { kind: 'undetermined' }, storyTime: '' }
        ]
      }
    })
  );
  return { fixture, workId, gu, lin, chapter, record, relation };
}

function snapshot(fixture: Fixture) {
  const result = value(fixture.app.executeAuthor({ method: 'snapshot', input: { workId: fixture.work.id } }));
  if (result.kind !== 'work') throw new Error('预期作品快照');
  return result;
}

/** 核对后正文又改过的事件与关系建立／结束数量。 */
function changedCount(fixture: Fixture): number {
  return value(fixture.app.executeAuthor({ method: 'listSourceReviews', input: { workId: fixture.work.id } })).reduce(
    (sum, review) => sum + review.recordIds.length + review.milestoneIds.length,
    0
  );
}

it('出处章节保存新正文后记录待复核，改标题不触发；整章确认绑定作者核对的修订', async () => {
  const { fixture, workId, chapter, record, relation } = await story();
  expect(changedCount(fixture)).toBe(0);
  const original = fixture.read();
  value(
    fixture.app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: chapter.id,
        expectedRevisionId: original.revisionId,
        title: '第一章',
        format: original.format,
        content: original.content
      }
    })
  );
  expect(changedCount(fixture)).toBe(0);

  const seen = fixture.save('将军守城。\n公主远行，未归。');
  expect(value(fixture.app.executeAuthor({ method: 'listSourceReviews', input: { workId } }))).toEqual([
    {
      chapterId: chapter.id,
      recordIds: [record.id],
      milestoneIds: [relation.milestones[0]!.id],
      earliestRevisionId: chapter.revisionId
    }
  ]);
  const listed = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'listRecords',
      input: { workId, resourceId: null, sourceId: chapter.id, asOf: null }
    })
  );
  expect(listed.map(record => record.sourceChanged)).toEqual([true]);
  const relations = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'listRelations',
      input: { workId, resourceId: null, asOf: null }
    })
  ).relations;
  expect(relations[0]!.milestones.map(item => item.sourceChanged)).toEqual([true, false]);

  // 作者打开核对后正文又被保存：确认绑定看到的版本，记录仍待复核。
  fixture.save('将军守城。\n公主远行，十年未归。');
  const confirm = () =>
    fixture.app.executeAuthor({
      method: 'confirmChapter',
      input: { commandId: randomUUID(), workId, chapterId: chapter.id, revisionId: seen.revisionId }
    });
  expect(value(confirm())).toEqual({ count: 2 });
  expect(changedCount(fixture)).toBe(2);
  const { records } = snapshot(fixture);
  expect(records[0]!.source).toEqual({ kind: 'chapter', chapterId: chapter.id, revisionId: seen.revisionId });

  const latest = fixture.read();
  value(
    fixture.app.executeAuthor({
      method: 'confirmChapter',
      input: { commandId: randomUUID(), workId, chapterId: chapter.id, revisionId: latest.revisionId }
    })
  );
  expect(changedCount(fixture)).toBe(0);
});

it('确认的修订须属于该章节', async () => {
  const { fixture, workId, chapter, gu } = await story();
  const result = fixture.app.executeAuthor({
    method: 'confirmChapter',
    input: { commandId: randomUUID(), workId, chapterId: chapter.id, revisionId: gu.revisionId }
  });
  expect(result.ok ? '' : result.error.message).toBe('核对的修订不属于该章节');
});

function trashEntries(fixture: Fixture, entryIds: string[]) {
  return value(
    fixture.app.executeAuthor({
      method: 'trashEntries',
      input: { commandId: randomUUID(), workId: fixture.work.id, entryIds }
    })
  );
}
function chapterEntry(fixture: Fixture, title: string) {
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

it('删除来源章节时事件与建立／结束同批进回收站，关系保留；恢复后同批回来，永久清空一并删除', async () => {
  const { fixture, workId, gu, lin, chapter, record, relation } = await story();
  const twelfth = chapterEntry(fixture, '第十二章');
  const start = relation.milestones[0]!;
  const ended = value(
    fixture.app.executeAuthor({
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId,
        relationId: relation.id,
        expectedRevisionId: relation.revisionId,
        resourceIds: [gu.id, lin.id],
        type: '师徒',
        directed: true,
        titles: ['师父', '徒弟'],
        milestones: [
          start,
          {
            id: null,
            kind: 'end',
            source: { kind: 'chapter', chapterId: twelfth.id, revisionId: twelfth.revisionId },
            placement: { kind: 'chapter', chapterId: twelfth.id },
            storyTime: ''
          }
        ]
      }
    })
  );
  const impact = value(
    fixture.app.executeAuthor({ method: 'previewTrash', input: { workId, entryIds: [twelfth.id] } })
  );
  expect(impact).toMatchObject({ recordCount: 0, milestoneCount: 1, relocatedCount: 0 });
  expect(impact.relationChanges).toEqual([
    {
      relationId: relation.id,
      type: '师徒',
      resourceIds: [gu.id, lin.id],
      change: { kind: 'state', fromChapterId: twelfth.id, state: 'active' }
    }
  ]);

  trashEntries(fixture, [twelfth.id]);
  expect(snapshot(fixture).relations[0]!.milestones.map(item => item.id)).toEqual([start.id]);
  const [batch] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId } }));
  expect(batch).toMatchObject({ records: [], relations: [], milestoneCount: 1 });
  // 关系仍可保存，回收站中的结束保留原行。
  const kept = snapshot(fixture).relations[0]!;
  value(
    fixture.app.executeAuthor({
      method: 'updateRelation',
      input: {
        commandId: randomUUID(),
        workId,
        relationId: kept.id,
        expectedRevisionId: kept.revisionId,
        resourceIds: kept.resourceIds,
        type: kept.type,
        directed: kept.directed,
        titles: ['恩师', '徒弟'],
        milestones: kept.milestones
      }
    })
  );
  value(
    fixture.app.executeAuthor({
      method: 'restoreTrash',
      input: { commandId: randomUUID(), workId, batchId: batch!.id }
    })
  );
  expect(snapshot(fixture).relations[0]!.milestones.map(item => item.id)).toEqual(
    ended.milestones.map(item => item.id)
  );

  // 删除唯一的建立所在章节：关系只剩结束，之后仍能保存。
  trashEntries(fixture, [chapter.id]);
  const remaining = snapshot(fixture);
  expect(remaining.records).toEqual([]);
  expect(remaining.relations[0]!.milestones.map(item => item.kind)).toEqual(['end']);
  const [latest] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId } }));
  expect(latest!.records.map(item => item.id)).toEqual([record.id]);
  value(
    fixture.app.executeAuthor({ method: 'purgeTrash', input: { commandId: randomUUID(), workId, batchId: latest!.id } })
  );
  expect(snapshot(fixture).relations[0]!.milestones.map(item => item.kind)).toEqual(['end']);
});

it('建立／结束全部出自被删章节的关系整条进入批次；仅作发生位置的章节删除后待重新定位，恢复后回到原位', async () => {
  const { fixture, workId, gu, lin, chapter } = await story();
  const other = chapterEntry(fixture, '第二章');
  const fromOther = { kind: 'chapter' as const, chapterId: other.id, revisionId: other.revisionId };
  const placedOnly = value(
    fixture.app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [lin.id],
        text: '林晚回忆拜师',
        source: fromOther,
        placement: { kind: 'chapter', chapterId: chapter.id },
        storyTime: ''
      }
    })
  );
  const enemies = value(
    fixture.app.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [gu.id, lin.id],
        type: '敌对',
        directed: false,
        titles: ['仇敌', '仇敌'],
        milestones: [
          {
            id: null,
            kind: 'start',
            source: fromOther,
            placement: { kind: 'chapter', chapterId: other.id },
            storyTime: ''
          },
          {
            id: null,
            kind: 'end',
            source: fromOther,
            placement: { kind: 'chapter', chapterId: other.id },
            storyTime: ''
          }
        ]
      }
    })
  );

  const impact = value(
    fixture.app.executeAuthor({ method: 'previewTrash', input: { workId, entryIds: [chapter.id] } })
  );
  expect(impact).toMatchObject({ recordCount: 1, milestoneCount: 1, relocatedCount: 1 });
  trashEntries(fixture, [chapter.id]);
  const after = snapshot(fixture);
  expect(after.records.map(item => item.id)).toEqual([placedOnly.id]);
  expect(after.records[0]!.placement).toEqual({ kind: 'chapter', chapterId: chapter.id });

  const whole = value(fixture.app.executeAuthor({ method: 'previewTrash', input: { workId, entryIds: [other.id] } }));
  expect(whole.relationChanges).toEqual([
    { relationId: enemies.id, type: '敌对', resourceIds: [gu.id, lin.id], change: { kind: 'removed' } }
  ]);
  trashEntries(fixture, [other.id]);
  expect(snapshot(fixture).relations.map(item => item.id)).not.toContain(enemies.id);
  const [batch] = value(fixture.app.executeAuthor({ method: 'listTrash', input: { workId } }));
  expect(batch).toMatchObject({ milestoneCount: 0, records: [{ id: placedOnly.id }], relations: [{ id: enemies.id }] });
  value(
    fixture.app.executeAuthor({
      method: 'restoreTrash',
      input: { commandId: randomUUID(), workId, batchId: batch!.id }
    })
  );
  expect(snapshot(fixture).relations.find(item => item.id === enemies.id)!.milestones).toHaveLength(2);
});

it('出处章节删除时拒绝出自该章的事件与关系候选，续跑结果标为作者已删除来源章节', async () => {
  const { fixture, workId, gu, chapter } = await story();
  const written = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [gu.id],
        text: '顾长风收徒',
        source: { kind: 'chapter', chapterId: chapter.id, revisionId: chapter.revisionId },
        placement: { kind: 'chapter', chapterId: chapter.id },
        storyTime: '',
        basis: '将军守城。'
      }
    })
  );
  if (written.kind !== 'pending') throw new Error('预期生成待接受修改');
  trashEntries(fixture, [chapter.id]);
  expect(
    value(fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId, sessionId: null } }))
  ).toEqual([]);
  const contents = value(
    fixture.app.executeAuthor({ method: 'listReviewResults', input: { sessionId: fixture.context.sessionId } })
  );
  expect(contents).toEqual([expect.objectContaining({ targetId: written.change.targetId, decision: 'sourceDeleted' })]);
});
