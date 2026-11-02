import type {
  DecideDeliveryInput,
  DecideReviewInput,
  DeliveryGroup,
  DeliveryItem,
  DeliverySummary,
  Entry,
  EntryChange,
  EntryReviewView,
  PendingChange,
  RelinkResourceInput,
  ReviewTarget,
  ReviewView,
  UpdateRecordReviewInput,
  UpdateRelationReviewInput,
  UpdateReviewInput
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';
import type { DeliveryService } from './delivery.ts';
import { draftChapters } from './draft-sources.ts';
import { EntryReview } from './entry/decisions.ts';
import { ChangeLedger, isStoryView } from './ledger.ts';
import { advanceChange, staleReason } from './pending-change.ts';
import { affectedByRemoval, type Removal } from './removal.ts';
import { StoryReview } from './story-decisions.ts';

/**
 * 审阅用例入口：本机库事务与回执、按目标分派到条目或事件与关系规则、整组决定、删除联动与中断恢复。
 * 接受先记录意图，作品库提交后再凭回执更新本机进度；恢复只补齐已有回执的进度。
 */
export class ReviewService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly delivery: DeliveryService;
  private readonly ledger: ChangeLedger;
  private readonly entries: EntryReview;
  private readonly stories: StoryReview;

  constructor(repository: CreationRepository, creation: CreationService, delivery: DeliveryService) {
    this.repository = repository;
    this.creation = creation;
    this.delivery = delivery;
    this.ledger = new ChangeLedger(repository);
    this.entries = new EntryReview(repository, creation, this.ledger);
    this.stories = new StoryReview(repository, creation, this.ledger);
  }

  list(workId: string | null, sessionId: string | null): PendingChange[] {
    this.recover();
    return this.ledger.pending(workId, sessionId);
  }
  read(id: string): ReviewView {
    this.recover();
    return this.ledger.view(this.ledger.get(id));
  }

  update(input: UpdateReviewInput): PendingChange {
    this.recover();
    return this.creation.commit(null, input.commandId, ['updateReview', input], { kind: 'review' }, () =>
      this.entries.update(input)
    );
  }
  updateRecord(input: UpdateRecordReviewInput): PendingChange {
    this.recover();
    return this.creation.commit(null, input.commandId, ['updateRecordReview', input], { kind: 'review' }, () =>
      this.stories.updateRecord(input)
    );
  }
  updateRelation(input: UpdateRelationReviewInput): PendingChange {
    this.recover();
    return this.creation.commit(null, input.commandId, ['updateRelationReview', input], { kind: 'review' }, () =>
      this.stories.updateRelation(input)
    );
  }
  relink(input: RelinkResourceInput): PendingChange {
    this.recover();
    const rejected = this.creation.commit(null, input.commandId, ['relinkResource', input], { kind: 'review' }, () =>
      this.stories.relink(input)
    );
    this.rejectTrashed(rejected.workId);
    return rejected;
  }

  /** 单项决定；被拒绝的新资料由 rejectTrashed 一并拒绝依赖它的事件与关系。 */
  decide(input: DecideReviewInput): PendingChange {
    this.recover();
    const change = this.ledger.get(input.changeId);
    if (input.decision === 'accept') this.repository.library.putReviewIntent(input);
    const parameters = ['decideReview', input] as const;
    const result = this.creation.commit(null, input.commandId, parameters, { kind: 'review' }, () =>
      change.target === 'entry'
        ? this.entries.decide(change, { input, parameters })
        : this.stories.decide(change, { input, parameters })
    );
    this.repository.library.clearReviewIntent(input.commandId);
    this.rejectTrashed(change.workId);
    if (result.target === 'entry' && result.status === 'rejected' && !result.authorEdited) this.rejectDrafts(result);
    return result;
  }

  /** 正文修改整篇被拒绝后，本会话出处仍指向它的事件与关系候选随之拒绝。 */
  private rejectDrafts(change: EntryChange): void {
    const work = this.repository.work(change.workId);
    for (const other of this.ledger.pending(change.workId, change.sessionId))
      if (other.target !== 'entry' && draftChapters(work, other).includes(change.targetId))
        this.creation.commit(null, `draft:${other.id}`, ['rejectDraft', other.id], { kind: 'review' }, () =>
          this.ledger.finish(other, { status: 'rejected' })
        );
  }

  /** 撤回本会话尚未接受的候选；新建条目连同以它为父目录的新建候选和依赖这些新资料的事件与关系候选。 */
  withdraw(change: PendingChange): PendingChange {
    const changes = this.ledger.pending(change.workId, change.sessionId);
    const withdrawn = new Set([change.targetId]);
    if (change.target === 'entry')
      for (let size = 0; size !== withdrawn.size;) {
        size = withdrawn.size;
        for (const other of changes)
          if (
            other.target === 'entry' &&
            other.candidate.parentId !== null &&
            withdrawn.has(other.candidate.parentId)
          ) {
            if (other.base !== null) throw new Error('此目录中还有本会话移入的条目，请先移出');
            withdrawn.add(other.targetId);
          }
      }
    const hit = (other: PendingChange): boolean =>
      withdrawn.has(other.targetId) ||
      (change.target === 'entry' &&
        other.target !== 'entry' &&
        other.candidate.resourceIds.some(id => withdrawn.has(id)));
    let root = change;
    for (const other of changes.filter(hit)) {
      const next = this.ledger.finish(other, { status: 'rejected' });
      this.delivery.detach(next);
      if (other.id === change.id) root = next;
    }
    return root;
  }

  deliveries(sessionId: string): DeliverySummary[] {
    this.recover();
    return this.delivery.list(sessionId).map(group => ({
      group,
      items: this.pendingIn(group).map(change => item(this.ledger.view(change)))
    }));
  }

  /**
   * 整组决定只覆盖一部作品：接受时全部候选与回执在该作品库的一个事务中提交，再凭回执更新本机进度。
   * 任何一项冲突或已变化都整体拒绝，列出需要先处理的内容。
   */
  decideDelivery(input: DecideDeliveryInput): DeliveryGroup {
    this.recover();
    const group = this.delivery.read(input.groupId).group;
    if (input.decision === 'accept') this.repository.library.putDeliveryIntent(input);
    const parameters = ['decideDelivery', input] as const;
    const result = this.creation.commit(null, input.commandId, parameters, { kind: 'delivery' }, () => {
      const changes = this.pendingIn(group).filter(change => change.workId === input.workId);
      if (this.repository.work(input.workId).readReceipt<Entry[]>(input.commandId, parameters)) {
        for (const change of changes) this.ledger.finishAccepted(change);
        return this.delivery.read(group.id).group;
      }
      const targets = new Map(input.targets.map(target => [target.changeId, target]));
      if (targets.size !== changes.length || changes.some(change => !targets.has(change.id)))
        throw new Error('待审修改已变化，请刷新后处理');
      const views = changes.map(change => this.ledger.view(change));
      const stale = views.filter(view => staleReason(view, targets.get(view.change.id)!) !== null);
      if (stale.length) throw new Error(`以下修改已变化，请刷新后处理：${titles(stale)}`);
      if (input.decision === 'accept') {
        const conflicted = views.filter(view => view.conflicts.length > 0);
        if (conflicted.length) throw new Error(`以下修改有冲突，请先逐项处理：${titles(conflicted)}`);
        // 按会话内的逻辑顺序写入：候选目录先于其中的新条目，新资料先于引用它的事件与关系。
        // oxlint-disable-next-line unicorn/no-array-sort
        const ordered = [...views].sort((a, b) => a.change.order - b.change.order);
        const work = this.repository.work(input.workId);
        this.creation.commit(input.workId, input.commandId, parameters, { kind: 'entries' }, () =>
          ordered.flatMap(view => {
            if (!isStoryView(view)) return this.entries.apply(work, view);
            this.stories.apply(work, view);
            return [];
          })
        );
        for (const change of changes) this.ledger.finishAccepted(change);
      } else {
        this.entries.assertUnreferenced(
          changes.filter((change): change is EntryChange => change.target === 'entry'),
          new Set(changes.map(change => change.id))
        );
        for (const change of changes) this.ledger.finish(change, { status: 'rejected' });
      }
      return this.delivery.read(group.id).group;
    });
    this.repository.library.clearDeliveryIntent(input.commandId);
    this.rejectTrashed(input.workId);
    return result;
  }

  /**
   * 删除提交后拒绝指向回收站内容的待审修改，包括挂在其下的新建候选，
   * 以及所引用新资料已被拒绝或撤回的事件与关系候选；恢复时再次执行即补齐。
   */
  rejectTrashed(workId: string | null): void {
    const changes = this.ledger.pending(workId, null);
    const removal = (owner: PendingChange): Removal => {
      const work = this.repository.work(owner.workId);
      return {
        entry: id => work.isTrashed(id),
        record: id => work.isRecordTrashed(id),
        relation: id => work.isRelationTrashed(id),
        missing: id =>
          !work.getEntry(id) &&
          !changes.some(
            other =>
              other.target === 'entry' &&
              other.sessionId === owner.sessionId &&
              other.base === null &&
              other.targetId === id
          )
      };
    };
    for (const change of affectedByRemoval(changes, removal))
      this.creation.commit(null, `trash:${change.id}`, ['rejectTrashed', change.id], { kind: 'review' }, () =>
        this.ledger.finish(change, { status: 'rejected' })
      );
  }

  /** 删除整部作品时拒绝其全部待审修改；须在作品库事务内调用。 */
  rejectWork(workId: string): void {
    const changes = this.ledger.pending(workId, null);
    for (const change of changes)
      for (const id of change.target === 'entry' ? (change.covers ?? []) : []) {
        const covered = this.repository.library.getPendingChange(id);
        if (covered?.status === 'covered')
          this.repository.library.putPendingChange(advanceChange(covered, { status: 'rejected' }));
      }
    for (const change of changes) this.ledger.finish(change, { status: 'rejected' });
  }

  /** 删除这些条目时会一并拒绝的待审修改数量。 */
  countAffected(workId: string, removedIds: ReadonlySet<string>): number {
    return affectedByRemoval(this.ledger.pending(workId, null), () => ({
      entry: id => removedIds.has(id),
      record: () => false,
      relation: () => false,
      missing: () => false
    })).length;
  }

  /** 恢复只补齐已有作品回执的进度；未提交的意图清除，不继续执行旧修改。 */
  private recover(): void {
    this.rejectTrashed(null);
    for (const input of this.repository.library.listDeliveryIntents()) {
      const parameters = ['decideDelivery', input] as const;
      if (this.repository.work(input.workId).readReceipt<Entry[]>(input.commandId, parameters)) {
        const group = this.delivery.read(input.groupId).group;
        this.creation.commit(null, input.commandId, parameters, { kind: 'delivery' }, () => {
          for (const change of this.pendingIn(group).filter(change => change.workId === input.workId))
            this.ledger.finishAccepted(change);
          return this.delivery.read(group.id).group;
        });
      }
      this.repository.library.clearDeliveryIntent(input.commandId);
    }
    for (const input of this.repository.library.listReviewIntents()) {
      const change = this.ledger.get(input.changeId);
      const parameters = ['decideReview', input] as const;
      if (this.repository.work(change.workId).readReceipt(input.commandId, parameters))
        this.creation.commit(null, input.commandId, parameters, { kind: 'review' }, () =>
          change.target === 'entry' ? this.entries.recover(change, input) : this.stories.recover(change)
        );
      this.repository.library.clearReviewIntent(input.commandId);
    }
  }

  private pendingIn(group: DeliveryGroup): PendingChange[] {
    return group.changeIds.map(id => this.ledger.get(id)).filter(change => change.status === 'pending');
  }
}

function item(view: ReviewView): DeliveryItem {
  const fields = {
    target: reviewTarget(view),
    workId: view.change.workId,
    targetId: view.change.targetId,
    created: view.current === null,
    deleted: view.change.deleted === true,
    conflicted: view.conflicts.length > 0
  };
  if (isStoryView(view, 'record')) return { ...fields, kind: 'record', record: view.candidate };
  if (isStoryView(view, 'relation')) return { ...fields, kind: 'relation', relation: view.candidate };
  return { ...fields, section: view.candidate.section, kind: view.candidate.kind, title: view.candidate.title };
}
/** 作者看到的版本；事件与关系没有目录位置。 */
function reviewTarget(view: ReviewView): ReviewTarget {
  const target = {
    changeId: view.change.id,
    expectedVersion: view.change.version,
    expectedRevisionId: view.current?.revisionId ?? null
  };
  if (isStoryView(view) || !view.current) return { ...target, expectedLocation: null };
  return { ...target, expectedLocation: { parentId: view.current.parentId, position: view.current.position } };
}
function titles(views: ReviewView[]): string {
  return views
    .map(view =>
      isStoryView(view, 'record')
        ? `事件“${view.candidate.text}”`
        : isStoryView(view, 'relation')
          ? `关系“${view.candidate.type}”`
          : `《${(view as EntryReviewView).candidate.title}》`
    )
    .join('、');
}
