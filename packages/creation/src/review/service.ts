import { randomUUID } from 'node:crypto';

import { applySnapshot, commitSnapshot } from '../content/commit.ts';
import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  DecideDeliveryInput,
  DecideReviewInput,
  DeliveryGroup,
  DeliveryItem,
  DeliverySummary,
  Entry,
  PendingChange,
  ReviewTarget,
  ReviewView,
  UpdateReviewInput
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';
import type { DeliveryService } from './delivery.ts';
import { mergeCandidate } from './merge.ts';
import { advanceChange, assertReviewTarget, decideBlock, sameContent, staleReason } from './pending-change.ts';

/** 审阅用例只协调候选决策、正式提交与中断恢复。 */
export class ReviewService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly delivery: DeliveryService;
  constructor(repository: CreationRepository, creation: CreationService, delivery: DeliveryService) {
    this.repository = repository;
    this.creation = creation;
    this.delivery = delivery;
  }
  list(workId: string | null, sessionId: string | null): PendingChange[] {
    this.recover();
    return this.repository.listPendingChanges(workId, sessionId);
  }
  read(id: string): ReviewView {
    this.recover();
    return this.view(this.get(id));
  }
  update(input: UpdateReviewInput): PendingChange {
    this.recover();
    return this.creation.commit(null, input.commandId, ['updateReview', input], { kind: 'review' }, () => {
      const view = this.checked(input);
      if ((view.candidate.kind !== 'document') !== (input.content === null)) throw new Error('候选正文与条目类型不符');
      const change = advanceChange(view.change, {
        base: view.current,
        candidate: { ...view.candidate, title: input.title, content: input.content },
        conflicts: input.resolveConflicts ? [] : view.conflicts,
        authorEdited: true
      });
      this.repository.putPendingChange(change);
      return change;
    });
  }
  decide(input: DecideReviewInput): PendingChange {
    this.recover();
    const change = this.get(input.changeId);
    if (input.decision === 'accept') this.repository.putReviewIntent(input);
    const parameters = ['decideReview', input] as const;
    const result = this.creation.commit(null, input.commandId, parameters, { kind: 'review' }, () => {
      const receipt = this.repository.readWorkReceipt<Entry>(change.workId, input.commandId, parameters);
      const partial = input.range !== undefined || input.part !== undefined;
      if (change.deleted) {
        if (partial) throw new Error('删除只能整篇接受或拒绝');
        if (input.decision === 'accept' && !receipt) {
          this.checked(input);
          this.creation.commit(change.workId, input.commandId, parameters, { kind: 'entries' }, () =>
            this.trashTargets(change.workId, [change])
          );
        }
        return this.finish(change, { status: input.decision === 'accept' ? 'accepted' : 'rejected' });
      }
      const view = receipt ? this.view(change) : this.checked(input);
      if (receipt)
        return this.finish(change, {
          base: view.current,
          candidate: view.candidate,
          status: partial && !sameContent(view.current, view.candidate) ? 'pending' : 'accepted',
          authorEdited: true
        });
      if (input.range && input.part) throw new Error('一次只能决定一处正文或标题');
      if (input.part === 'title') {
        if (!view.current || view.current.title === view.candidate.title) throw new Error('这项修改没有改名可单独处理');
        let current = view.current;
        let candidate = view.candidate;
        if (input.decision === 'accept') {
          if (view.conflicts.some(conflict => conflict.field === 'title'))
            throw new Error('标题有冲突，请先处理冲突再接受改名');
          // 只提交标题；正文与目录位置沿用正式稿，候选其余部分继续待审。
          commitSnapshot(this.repository, this.creation.commit.bind(this.creation), {
            workId: change.workId,
            commandId: input.commandId,
            parameters,
            base: current,
            candidate: { ...current, title: candidate.title },
            source: 'review'
          });
          current = readEntrySnapshot(this.repository, change.workId, change.entryId)!;
        } else candidate = { ...candidate, title: current.title };
        return this.finish(change, {
          base: current,
          candidate,
          conflicts: view.conflicts.filter(conflict => conflict.field !== 'title'),
          authorEdited: true,
          status: sameContent(current, candidate) ? (input.decision === 'accept' ? 'accepted' : 'rejected') : 'pending'
        });
      }
      if (input.range) {
        const block = decideBlock(view, { ...input, range: input.range });
        let current = view.current;
        if (block.accepted) {
          commitSnapshot(this.repository, this.creation.commit.bind(this.creation), {
            workId: change.workId,
            commandId: input.commandId,
            parameters,
            base: current,
            candidate: block.accepted,
            source: 'review'
          });
          current = readEntrySnapshot(this.repository, change.workId, change.entryId);
        }
        return this.finish(change, {
          base: current,
          candidate: block.candidate,
          conflicts: view.conflicts,
          authorEdited: true,
          status: sameContent(current, block.candidate)
            ? input.decision === 'accept'
              ? 'accepted'
              : 'rejected'
            : 'pending'
        });
      }
      if (input.decision === 'accept') {
        if (view.conflicts.length) throw new Error('请先处理冲突，再接受修改');
        commitSnapshot(this.repository, this.creation.commit.bind(this.creation), {
          workId: change.workId,
          commandId: input.commandId,
          parameters,
          base: view.current,
          candidate: view.candidate,
          source: 'review'
        });
      } else if (
        change.base === null &&
        this.list(change.workId, change.sessionId).some(other => other.candidate.parentId === change.entryId)
      ) {
        throw new Error('请先处理引用此目录的待接受修改');
      }
      return this.finish(change, { status: input.decision === 'accept' ? 'accepted' : 'rejected' });
    });
    this.repository.clearReviewIntent(input.commandId);
    if (change.deleted) this.rejectTrashed(change.workId);
    return result;
  }

  /** 撤回本会话尚未接受的新建候选，连同以它为父目录的新建候选。 */
  withdraw(change: PendingChange): PendingChange {
    const changes = this.repository.listPendingChanges(change.workId, change.sessionId);
    const withdrawn = new Set([change.entryId]);
    for (let size = 0; size !== withdrawn.size;) {
      size = withdrawn.size;
      for (const other of changes)
        if (other.candidate.parentId !== null && withdrawn.has(other.candidate.parentId)) {
          if (other.base !== null) throw new Error('此目录中还有本会话移入的条目，请先移出');
          withdrawn.add(other.entryId);
        }
    }
    let root = change;
    for (const other of changes.filter(candidate => withdrawn.has(candidate.entryId))) {
      const next = this.finish(other, { status: 'rejected' });
      this.delivery.detach(next);
      if (other.id === change.id) root = next;
    }
    return root;
  }

  deliveries(sessionId: string): DeliverySummary[] {
    this.recover();
    return this.delivery.list(sessionId).map(group => ({
      group,
      items: this.pendingIn(group).map(change => item(this.view(change)))
    }));
  }

  /**
   * 整组决定只覆盖一部作品：接受时全部候选与回执在该作品库的一个事务中提交，再凭回执更新本机进度。
   * 任何一项冲突或已变化都整体拒绝，列出需要先处理的条目。
   */
  decideDelivery(input: DecideDeliveryInput): DeliveryGroup {
    this.recover();
    const group = this.delivery.read(input.groupId).group;
    if (input.decision === 'accept') this.repository.putDeliveryIntent(input);
    const parameters = ['decideDelivery', input] as const;
    const result = this.creation.commit(null, input.commandId, parameters, { kind: 'delivery' }, () => {
      const changes = this.pendingIn(group).filter(change => change.workId === input.workId);
      if (this.repository.readWorkReceipt<Entry[]>(input.workId, input.commandId, parameters)) {
        for (const change of changes) this.finishAccepted(change);
        return this.delivery.read(group.id).group;
      }
      const targets = new Map(input.targets.map(target => [target.changeId, target]));
      if (targets.size !== changes.length || changes.some(change => !targets.has(change.id)))
        throw new Error('待审修改已变化，请刷新后处理');
      const views = changes.map(change => this.view(change));
      const stale = views.filter(view => staleReason(view, targets.get(view.change.id)!) !== null);
      if (stale.length) throw new Error(`以下修改已变化，请刷新后处理：${titles(stale)}`);
      if (input.decision === 'accept') {
        const conflicted = views.filter(view => view.conflicts.length > 0);
        if (conflicted.length) throw new Error(`以下修改有冲突，请先逐项处理：${titles(conflicted)}`);
        // 按会话内的逻辑顺序写入，候选目录先于其中的新条目建立。
        // oxlint-disable-next-line unicorn/no-array-sort
        const ordered = [...views].sort((a, b) => a.change.order - b.change.order);
        this.creation.commit(input.workId, input.commandId, parameters, { kind: 'entries' }, () =>
          ordered.flatMap(view =>
            view.change.deleted
              ? this.trashTargets(input.workId, [view.change])
              : [
                  applySnapshot(this.repository, {
                    workId: input.workId,
                    base: view.current,
                    candidate: view.candidate,
                    source: 'review'
                  })
                ]
          )
        );
        for (const change of changes) this.finishAccepted(change);
      } else {
        const rejected = new Set(changes.map(change => change.id));
        const referenced = this.repository
          .listPendingChanges(input.workId, group.sessionId)
          .some(
            other =>
              !rejected.has(other.id) &&
              changes.some(change => change.base === null && other.candidate.parentId === change.entryId)
          );
        if (referenced) throw new Error('请先处理引用此目录的待接受修改');
        for (const change of changes) this.finish(change, { status: 'rejected' });
      }
      return this.delivery.read(group.id).group;
    });
    this.repository.clearDeliveryIntent(input.commandId);
    this.rejectTrashed(input.workId);
    return result;
  }

  /** 删除提交后拒绝指向回收站条目的待审修改，包括挂在其下的新建候选；恢复时再次执行即补齐。 */
  rejectTrashed(workId: string | null): void {
    const changes = this.repository.listPendingChanges(workId, null);
    for (const change of affectedByRemoval(changes, owner => id => this.repository.isTrashed(owner.workId, id)))
      this.creation.commit(null, `trash:${change.id}`, ['rejectTrashed', change.id], { kind: 'review' }, () =>
        this.finish(change, { status: 'rejected' })
      );
  }

  /** 删除整部作品时拒绝其全部待审修改；须在作品库事务内调用。 */
  rejectWork(workId: string): void {
    const changes = this.repository.listPendingChanges(workId, null);
    for (const change of changes)
      for (const id of change.covers ?? []) {
        const covered = this.repository.getPendingChange(id);
        if (covered?.status === 'covered')
          this.repository.putPendingChange(advanceChange(covered, { status: 'rejected' }));
      }
    for (const change of changes) this.finish(change, { status: 'rejected' });
  }

  /** 删除这些条目时会一并拒绝的待审修改数量。 */
  countAffected(workId: string, removedIds: ReadonlySet<string>): number {
    return affectedByRemoval(this.repository.listPendingChanges(workId, null), () => id => removedIds.has(id)).length;
  }

  /** 恢复只补齐已有作品回执的进度；未提交的意图清除，不继续执行旧修改。 */
  private recover(): void {
    this.rejectTrashed(null);
    for (const input of this.repository.listDeliveryIntents()) {
      const parameters = ['decideDelivery', input] as const;
      if (this.repository.readWorkReceipt<Entry[]>(input.workId, input.commandId, parameters)) {
        const group = this.delivery.read(input.groupId).group;
        this.creation.commit(null, input.commandId, parameters, { kind: 'delivery' }, () => {
          for (const change of this.pendingIn(group).filter(item => item.workId === input.workId))
            this.finishAccepted(change);
          return this.delivery.read(group.id).group;
        });
      }
      this.repository.clearDeliveryIntent(input.commandId);
    }
    for (const input of this.repository.listReviewIntents()) {
      const change = this.get(input.changeId);
      const parameters = ['decideReview', input] as const;
      if (this.repository.readWorkReceipt<Entry>(change.workId, input.commandId, parameters)) {
        this.creation.commit(null, input.commandId, parameters, { kind: 'review' }, () => {
          const view = this.view(change);
          return this.finish(change, {
            base: view.current,
            candidate: view.candidate,
            authorEdited: true,
            status: input.range && !sameContent(view.current, view.candidate) ? 'pending' : 'accepted'
          });
        });
      }
      this.repository.clearReviewIntent(input.commandId);
    }
  }
  private pendingIn(group: DeliveryGroup): PendingChange[] {
    return group.changeIds.map(id => this.get(id)).filter(change => change.status === 'pending');
  }
  private finishAccepted(change: PendingChange): void {
    const view = this.view(change);
    this.finish(change, { base: view.current, candidate: view.candidate, status: 'accepted' });
  }
  /** 删除候选结束时处理并入的修改：接受则一并拒绝，拒绝则恢复待审。 */
  private finish(change: PendingChange, fields: Partial<PendingChange>): PendingChange {
    const next = advanceChange(change, fields);
    this.repository.putPendingChange(next);
    if (next.deleted && next.status !== 'pending')
      for (const id of next.covers ?? []) {
        const covered = this.repository.getPendingChange(id);
        if (covered?.status === 'covered')
          this.repository.putPendingChange(
            advanceChange(covered, { status: next.status === 'accepted' ? 'rejected' : 'pending' })
          );
      }
    return next;
  }
  private trashTargets(workId: string, changes: PendingChange[]): Entry[] {
    const entries = this.repository.listEntries(workId);
    const ids = new Set(
      this.repository.trashEntries(
        workId,
        changes.map(change => change.entryId),
        randomUUID(),
        Date.now()
      )
    );
    return entries.filter(entry => ids.has(entry.id));
  }
  private get(id: string): PendingChange {
    const change = this.repository.getPendingChange(id);
    if (!change) throw new Error('待接受修改不存在');
    return change;
  }
  private checked(input: ReviewTarget): ReviewView {
    const view = this.view(this.get(input.changeId));
    assertReviewTarget(view, input);
    return view;
  }
  private view(change: PendingChange): ReviewView {
    return mergeCandidate(change, readEntrySnapshot(this.repository, change.workId, change.entryId));
  }
}

function item(view: ReviewView): DeliveryItem {
  const { change, current, candidate } = view;
  return {
    target: {
      changeId: change.id,
      expectedVersion: change.version,
      expectedRevisionId: current?.revisionId ?? null,
      expectedLocation: current ? { parentId: current.parentId, position: current.position } : null
    },
    workId: change.workId,
    entryId: change.entryId,
    section: candidate.section,
    kind: candidate.kind,
    title: candidate.title,
    created: current === null,
    deleted: change.deleted === true,
    conflicted: view.conflicts.length > 0
  };
}
/** 目标条目或候选父目录被删除的修改受影响；挂在受影响新建目录下的候选随之受影响。 */
function affectedByRemoval(
  changes: PendingChange[],
  removedIn: (change: PendingChange) => (entryId: string) => boolean
): PendingChange[] {
  const affected: PendingChange[] = [];
  const removedCreated = new Set<string>();
  let remaining = changes;
  let found = true;
  while (found) {
    found = false;
    remaining = remaining.filter(change => {
      const removed = removedIn(change);
      const { parentId } = change.candidate;
      const hit = removed(change.entryId) || (parentId !== null && (removed(parentId) || removedCreated.has(parentId)));
      if (!hit) return true;
      affected.push(change);
      if (change.base === null) removedCreated.add(change.entryId);
      found = true;
      return false;
    });
  }
  return affected;
}
function titles(views: ReviewView[]): string {
  return views.map(view => `《${view.candidate.title}》`).join('、');
}
