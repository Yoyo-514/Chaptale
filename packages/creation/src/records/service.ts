import { randomUUID } from 'node:crypto';

import type {
  ConfirmChapterInput,
  CreateRecordInput,
  RecordSource,
  SourceReview,
  MoveRecordInput,
  RemoveRecordInput,
  StoryRecord,
  UpdateRecordInput
} from '../contracts/records.ts';
import { RevisionConflictError } from '../errors.ts';
import { applyRelationSnapshot } from '../relations/commit.ts';
import type { CreationRepository } from '../repository.ts';
import { recordSnapshot } from '../review/record/merge.ts';
import { relationSnapshot } from '../review/relation/merge.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import { applyRecordSnapshot } from './commit.ts';
import { sameContent, sourceReviews } from './sources.ts';

/** 作者直接维护事件：新建、修改、调整顺序与移入回收站，每次提交生成回执。 */
export class RecordService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  create(input: CreateRecordInput): StoryRecord {
    const { commandId, workId, ...fields } = input;
    return this.creation.commit(workId, commandId, ['createRecord', input], { kind: 'record', removed: false }, () =>
      applyRecordSnapshot(this.repository.work(workId), {
        base: null,
        candidate: { id: randomUUID(), ...fields },
        source: 'author'
      })
    );
  }

  update(input: UpdateRecordInput): StoryRecord {
    const { commandId, workId, recordId, expectedRevisionId, ...fields } = input;
    return this.creation.commit(workId, commandId, ['updateRecord', input], { kind: 'record', removed: false }, () => {
      const base = this.current(workId, recordId, expectedRevisionId);
      return applyRecordSnapshot(this.repository.work(workId), {
        base,
        candidate: { id: recordId, ...fields },
        source: 'author'
      });
    });
  }

  move(input: MoveRecordInput): StoryRecord {
    return this.creation.commit(input.workId, input.commandId, ['moveRecord', input], { kind: 'records' }, () => {
      const work = this.repository.work(input.workId);
      if (!work.getRecord(input.recordId)) throw new Error('事件不存在');
      if (input.beforeId !== null && !work.getRecord(input.beforeId)) throw new Error('目标位置的事件不存在');
      return work.moveRecord(input.recordId, input.beforeId);
    });
  }

  /** 出处为本章且核对版本不同的事件与关系建立／结束，改为绑定作者核对的修订。 */
  confirmChapter(input: ConfirmChapterInput): { count: number } {
    const { commandId, workId, chapterId, revisionId } = input;
    return this.creation.commit(workId, commandId, ['confirmChapter', input], { kind: 'records' }, () => {
      const work = this.repository.work(workId);
      if (work.getRevisionEntryId(revisionId) !== chapterId) throw new Error('核对的修订不属于该章节');
      const stale = (source: RecordSource) =>
        source.kind === 'chapter' &&
        source.chapterId === chapterId &&
        !sameContent(work, source.revisionId, revisionId);
      const source: RecordSource = { kind: 'chapter', chapterId, revisionId };
      let count = 0;
      for (const record of work.listRecords()) {
        if (!stale(record.source)) continue;
        applyRecordSnapshot(work, { base: record, candidate: { ...recordSnapshot(record), source }, source: 'author' });
        count++;
      }
      for (const relation of work.listRelations()) {
        const changed = relation.milestones.filter(milestone => stale(milestone.source)).length;
        if (!changed) continue;
        const snapshot = relationSnapshot(relation);
        applyRelationSnapshot(work, {
          base: relation,
          candidate: {
            ...snapshot,
            milestones: snapshot.milestones.map(milestone =>
              stale(milestone.source) ? { ...milestone, source } : milestone
            )
          },
          source: 'author'
        });
        count += changed;
      }
      return { count };
    });
  }

  sourceReviews(workId: string): SourceReview[] {
    return sourceReviews(this.repository.work(workId));
  }

  remove(input: RemoveRecordInput): StoryRecord {
    const removed = this.creation.commit(
      input.workId,
      input.commandId,
      ['removeRecord', input],
      { kind: 'record', removed: true },
      () => {
        const record = this.current(input.workId, input.recordId, input.expectedRevisionId);
        this.repository.work(input.workId).trashRecord(record.id, randomUUID(), Date.now());
        return record;
      }
    );
    this.review.rejectTrashed(input.workId);
    return removed;
  }

  private current(workId: string, recordId: string, expectedRevisionId: string): StoryRecord {
    const work = this.repository.work(workId);
    const record = work.getRecord(recordId);
    if (!record) throw new Error(work.isRecordTrashed(recordId) ? '事件在回收站中' : '事件不存在');
    if (record.revisionId !== expectedRevisionId)
      throw new RevisionConflictError(expectedRevisionId, record.revisionId);
    return record;
  }
}
