import { randomUUID } from 'node:crypto';

import { applySnapshot } from '../content/commit.ts';
import type {
  EntryChange,
  PendingChange,
  RecordChange,
  RelationChange,
  RelinkResourceInput,
  UpdateRecordReviewInput,
  UpdateRelationReviewInput
} from '../contracts.ts';
import { applyRecordSnapshot, normalizeRecord } from '../records/commit.ts';
import { applyRelationSnapshot, assertRelationShape, relationSnapshot } from '../relations/commit.ts';
import type { CreationRepository, WorkRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';
import { bindDraftSources, draftChapters } from './draft-sources.ts';
import type { ReviewDecision } from './entry/decisions.ts';
import { isStoryView, type ChangeLedger, type StoryChange, type StoryView } from './ledger.ts';
import { advanceChange } from './pending-change.ts';
import { recordSnapshot } from './record/merge.ts';
import { relationSnapshot as snapshotOf } from './relation/merge.ts';

const label = { record: '事件', relation: '关系' } as const;

/**
 * 事件与关系候选的审阅规则：整条接受或拒绝、作者手改、改为关联已有资料；在调用方的本机库事务中执行。
 * 接受依赖本会话新资料候选的事件或关系时，新资料先写入，共用作品库事务与回执。
 */
export class StoryReview {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly ledger: ChangeLedger;

  constructor(repository: CreationRepository, creation: CreationService, ledger: ChangeLedger) {
    this.repository = repository;
    this.creation = creation;
    this.ledger = ledger;
  }

  /** 引用在接受时校验。 */
  updateRecord(input: UpdateRecordReviewInput): PendingChange {
    const view = this.checked(input, 'record');
    const { resourceIds, text, source, placement, storyTime } = normalizeRecord(input);
    if (!text) throw new Error('事件内容不能为空');
    if (!resourceIds.length) throw new Error('事件至少涉及一份资料');
    return this.edited(view.change, {
      base: view.current ? recordSnapshot(view.current) : null,
      candidate: { id: view.change.targetId, resourceIds, text, source, placement, storyTime },
      conflicts: input.resolveConflicts ? [] : view.conflicts
    });
  }

  /** 新增的建立／结束不带 ID；已有的须来自当前候选。引用在接受时校验。 */
  updateRelation(input: UpdateRelationReviewInput): PendingChange {
    const view = this.checked(input, 'relation');
    const candidate = relationSnapshot(view.change.targetId, input, view.candidate);
    assertRelationShape(candidate, this.repository.work(view.change.workId).hasTrashedStart(candidate.id));
    return this.edited(view.change, {
      base: view.current ? snapshotOf(view.current) : null,
      candidate,
      conflicts: input.resolveConflicts ? [] : view.conflicts
    });
  }

  /** 依赖新资料候选的事件与关系候选改为关联已有资料，再拒绝该新资料候选。 */
  relink(input: RelinkResourceInput): PendingChange {
    const change = this.ledger.get(input.changeId);
    if (change.status !== 'pending' || change.version !== input.expectedVersion)
      throw new Error('待接受修改已有新版本，请刷新后审阅');
    if (change.target !== 'entry' || change.base !== null || change.candidate.section !== 'resource')
      throw new Error('只能把新资料改为关联已有资料');
    const work = this.repository.work(change.workId);
    const target = work.getEntry(input.resourceId);
    if (!target || target.section !== 'resource' || target.kind !== 'document' || work.isTrashed(target.id))
      throw new Error('所选资料不存在');
    const swap = (id: string) => (id === change.targetId ? target.id : id);
    for (const dependent of this.dependents(change)) {
      if (dependent.target === 'record') {
        const resourceIds = [...new Set(dependent.candidate.resourceIds.map(swap))];
        this.repository.library.putPendingChange(
          advanceChange(dependent, { candidate: { ...dependent.candidate, resourceIds }, authorEdited: true })
        );
        continue;
      }
      const [first, second] = dependent.candidate.resourceIds.map(swap);
      if (first === second) throw new Error('关系双方不能是同一份资料，请改选其他资料');
      this.repository.library.putPendingChange(
        advanceChange(dependent, {
          candidate: { ...dependent.candidate, resourceIds: [first!, second!] },
          authorEdited: true
        })
      );
    }
    return this.ledger.finish(change, { status: 'rejected' });
  }

  decide(change: StoryChange, { input, parameters }: ReviewDecision): PendingChange {
    const name = label[change.target];
    if (input.range !== undefined || input.part !== undefined) throw new Error(`${name}只能整条接受或拒绝`);
    const work = this.repository.work(change.workId);
    if (work.readReceipt(input.commandId, parameters)) return this.recover(change);
    const view = this.checked(input, change.target);
    if (input.decision === 'reject') return this.ledger.finish(change, { status: 'rejected' });
    if (view.conflicts.length) throw new Error('请先处理冲突，再接受修改');
    const drafts = draftChapters(work, change);
    if (
      this.ledger
        .pending(change.workId, change.sessionId)
        .some(other => other.target === 'entry' && drafts.includes(other.targetId))
    )
      throw new Error('请先处理本章正文');
    const dependencies = this.dependencies(change);
    if (dependencies.length && !change.deleted)
      this.creation.commit(change.workId, input.commandId, parameters, { kind: 'entries' }, () => {
        const entries = dependencies.map(dependency => {
          const resource = this.ledger.entryView(dependency);
          if (resource.conflicts.length) throw new Error('新资料有冲突，请先处理');
          return applySnapshot(work, { base: null, candidate: resource.candidate, source: 'review' });
        });
        this.apply(work, view);
        return entries;
      });
    else
      this.creation.commit(
        change.workId,
        input.commandId,
        parameters,
        { kind: change.target, removed: change.deleted === true },
        () => this.apply(work, view)
      );
    return this.recover(change);
  }

  /** 作品库已有回执：目标与一并提交的新资料都按正式稿记为已接受。 */
  recover(change: StoryChange): PendingChange {
    for (const dependency of this.dependencies(change)) this.ledger.finishAccepted(dependency);
    return this.ledger.finishAccepted(change);
  }

  /** 整组接受中的一项，在调用方的作品库事务中写入；移除时返回移除前的正式内容。 */
  apply(work: WorkRepository, view: StoryView) {
    const { change } = view;
    if (change.deleted) {
      if (change.target === 'record') work.trashRecord(change.targetId, randomUUID(), Date.now());
      else work.trashRelation(change.targetId, randomUUID(), Date.now());
      return view.current!;
    }
    if (isStoryView(view, 'record'))
      return applyRecordSnapshot(work, {
        base: view.current,
        candidate: bindDraftSources(work, view.candidate),
        source: 'review'
      });
    if (isStoryView(view, 'relation'))
      return applyRelationSnapshot(work, {
        base: view.current,
        candidate: bindDraftSources(work, view.candidate),
        source: 'review'
      });
    throw new Error('这项修改不是事件或关系');
  }

  /** 候选引用的、本会话尚未接受的新资料候选。 */
  private dependencies(change: StoryChange): EntryChange[] {
    const resourceIds: readonly string[] = change.candidate.resourceIds;
    return this.ledger
      .pending(change.workId, change.sessionId)
      .filter(
        (other): other is EntryChange =>
          other.target === 'entry' && other.base === null && resourceIds.includes(other.targetId)
      );
  }

  /** 引用这份新资料候选的本会话事件与关系候选。 */
  private dependents(change: EntryChange): StoryChange[] {
    return this.ledger
      .pending(change.workId, change.sessionId)
      .filter(
        (other): other is StoryChange =>
          other.target !== 'entry' && (other.candidate.resourceIds as readonly string[]).includes(change.targetId)
      );
  }

  private edited<T extends RecordChange | RelationChange>(change: T, fields: Partial<T>): PendingChange {
    if (change.deleted) throw new Error(`移除${label[change.target]}只能接受或拒绝`);
    const next = advanceChange(change, { ...fields, authorEdited: true });
    this.repository.library.putPendingChange(next);
    return next;
  }

  private checked<K extends StoryChange['target']>(
    input: UpdateRecordReviewInput | UpdateRelationReviewInput | ReviewDecision['input'],
    target: K
  ): Extract<StoryView, { change: { target: K } }> {
    const view = this.ledger.checked(input);
    if (!isStoryView(view, target)) throw new Error(`这项修改不是${label[target]}`);
    return view as Extract<StoryView, { change: { target: K } }>;
  }
}
