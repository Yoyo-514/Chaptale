import { randomUUID } from 'node:crypto';

import type {
  CreateRecordInput,
  MoveRecordInput,
  RemoveRecordInput,
  StoryRecord,
  UpdateRecordInput
} from '../contracts/records.ts';
import { RevisionConflictError } from '../errors.ts';
import type { CreationRepository } from '../repository.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import { applyRecordSnapshot } from './commit.ts';

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
