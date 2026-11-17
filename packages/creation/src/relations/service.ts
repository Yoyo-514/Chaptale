import { randomUUID } from 'node:crypto';

import type {
  CreateRelationInput,
  RemoveRelationInput,
  StoryRelation,
  UpdateRelationInput
} from '../contracts/relations.ts';
import { RevisionConflictError } from '../errors.ts';
import type { CreationRepository } from '../repository.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';
import { applyRelationSnapshot, buildRelationSnapshot } from './commit.ts';

/** 作者直接维护关系：新建、整条修改与移入回收站，每次提交生成回执。 */
export class RelationService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  create(input: CreateRelationInput): StoryRelation {
    const { commandId, workId, ...fields } = input;
    return this.creation.commit(
      workId,
      commandId,
      ['createRelation', input],
      { kind: 'relation', removed: false },
      () =>
        applyRelationSnapshot(this.repository.work(workId), {
          base: null,
          candidate: buildRelationSnapshot(randomUUID(), fields, null),
          source: 'author'
        })
    );
  }

  update(input: UpdateRelationInput): StoryRelation {
    const { commandId, workId, relationId, expectedRevisionId, ...fields } = input;
    return this.creation.commit(
      workId,
      commandId,
      ['updateRelation', input],
      { kind: 'relation', removed: false },
      () => {
        const base = this.current(workId, relationId, expectedRevisionId);
        return applyRelationSnapshot(this.repository.work(workId), {
          base,
          candidate: buildRelationSnapshot(relationId, fields, base),
          source: 'author'
        });
      }
    );
  }

  remove(input: RemoveRelationInput): StoryRelation {
    const removed = this.creation.commit(
      input.workId,
      input.commandId,
      ['removeRelation', input],
      { kind: 'relation', removed: true },
      () => {
        const relation = this.current(input.workId, input.relationId, input.expectedRevisionId);
        this.repository.work(input.workId).trashRelation(relation.id, randomUUID(), Date.now());
        return relation;
      }
    );
    this.review.rejectTrashed(input.workId);
    return removed;
  }

  private current(workId: string, relationId: string, expectedRevisionId: string): StoryRelation {
    const work = this.repository.work(workId);
    const relation = work.getRelation(relationId);
    if (!relation) throw new Error(work.isRelationTrashed(relationId) ? '关系在回收站中' : '关系不存在');
    if (relation.revisionId !== expectedRevisionId)
      throw new RevisionConflictError(expectedRevisionId, relation.revisionId);
    return relation;
  }
}
