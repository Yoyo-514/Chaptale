import { randomUUID } from 'node:crypto';

import { applySnapshot } from '../../content/commit.ts';
import type {
  EntryChange,
  PendingChange,
  RecordChange,
  RecordReviewView,
  RelinkResourceInput,
  UpdateRecordReviewInput
} from '../../contracts.ts';
import { applyRecordSnapshot, normalizeRecord } from '../../records/commit.ts';
import type { CreationRepository, WorkRepository } from '../../repository.ts';
import type { CreationService } from '../../service.ts';
import type { ReviewDecision } from '../entry/decisions.ts';
import type { ChangeLedger } from '../ledger.ts';
import { advanceChange } from '../pending-change.ts';
import { recordSnapshot } from './merge.ts';

/**
 * 事件候选的审阅规则：整条接受或拒绝、作者手改、改为关联已有资料；在调用方的本机库事务中执行。
 * 接受依赖本会话新资料候选的事件时，新资料先于事件写入，共用作品库事务与回执。
 */
export class RecordReview {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly ledger: ChangeLedger;

  constructor(repository: CreationRepository, creation: CreationService, ledger: ChangeLedger) {
    this.repository = repository;
    this.creation = creation;
    this.ledger = ledger;
  }

  /** 引用在接受时校验。 */
  update(input: UpdateRecordReviewInput): PendingChange {
    const view = this.checked(input);
    if (view.change.deleted) throw new Error('移除事件只能接受或拒绝');
    const { resourceIds, text, source, placement, storyTime } = normalizeRecord(input);
    if (!text) throw new Error('事件内容不能为空');
    if (!resourceIds.length) throw new Error('事件至少涉及一份资料');
    const change = advanceChange(view.change, {
      base: view.current ? recordSnapshot(view.current) : null,
      candidate: { id: view.change.targetId, resourceIds, text, source, placement, storyTime },
      conflicts: input.resolveConflicts ? [] : view.conflicts,
      authorEdited: true
    });
    this.repository.library.putPendingChange(change);
    return change;
  }

  /** 依赖新资料候选的事件候选改为关联已有资料，再拒绝该新资料候选。 */
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
    for (const record of this.dependents(change)) {
      const resourceIds = [
        ...new Set(record.candidate.resourceIds.map(id => (id === change.targetId ? target.id : id)))
      ];
      this.repository.library.putPendingChange(
        advanceChange(record, { candidate: { ...record.candidate, resourceIds }, authorEdited: true })
      );
    }
    return this.ledger.finish(change, { status: 'rejected' });
  }

  decide(change: RecordChange, { input, parameters }: ReviewDecision): PendingChange {
    if (input.range !== undefined || input.part !== undefined) throw new Error('事件只能整条接受或拒绝');
    const work = this.repository.work(change.workId);
    if (work.readReceipt(input.commandId, parameters)) return this.recover(change);
    const view = this.checked(input);
    if (input.decision === 'reject') return this.ledger.finish(change, { status: 'rejected' });
    if (view.conflicts.length) throw new Error('请先处理冲突，再接受修改');
    const dependencies = this.dependencies(change);
    if (change.deleted)
      this.creation.commit(change.workId, input.commandId, parameters, { kind: 'record', removed: true }, () => {
        work.trashRecord(change.targetId, randomUUID(), Date.now());
        return view.current!;
      });
    else if (dependencies.length)
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
      this.creation.commit(change.workId, input.commandId, parameters, { kind: 'record', removed: false }, () =>
        applyRecordSnapshot(work, { base: view.current, candidate: view.candidate, source: 'review' })
      );
    return this.recover(change);
  }

  /** 作品库已有回执：事件与一并提交的新资料都按正式稿记为已接受。 */
  recover(change: RecordChange): PendingChange {
    for (const dependency of this.dependencies(change)) this.ledger.finishAccepted(dependency);
    return this.ledger.finishAccepted(change);
  }

  /** 整组接受中的一项，在调用方的作品库事务中写入。 */
  apply(work: WorkRepository, view: RecordReviewView): void {
    if (view.change.deleted) work.trashRecord(view.change.targetId, randomUUID(), Date.now());
    else applyRecordSnapshot(work, { base: view.current, candidate: view.candidate, source: 'review' });
  }

  /** 事件候选引用的、本会话尚未接受的新资料候选。 */
  private dependencies(change: RecordChange): EntryChange[] {
    return this.ledger
      .pending(change.workId, change.sessionId)
      .filter(
        (other): other is EntryChange =>
          other.target === 'entry' && other.base === null && change.candidate.resourceIds.includes(other.targetId)
      );
  }

  /** 引用这份新资料候选的本会话事件候选。 */
  private dependents(change: EntryChange): RecordChange[] {
    return this.ledger
      .pending(change.workId, change.sessionId)
      .filter(
        (other): other is RecordChange =>
          other.target === 'record' && other.candidate.resourceIds.includes(change.targetId)
      );
  }

  private checked(input: UpdateRecordReviewInput | ReviewDecision['input']): RecordReviewView {
    const view = this.ledger.checked(input);
    if (view.change.target !== 'record') throw new Error('这项修改不是事件');
    return view as RecordReviewView;
  }
}
