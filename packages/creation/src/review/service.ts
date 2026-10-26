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
      if ((view.candidate.kind === 'directory') !== (input.content === null)) throw new Error('候选正文与条目类型不符');
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
      const view = receipt ? this.view(change) : this.checked(input);
      if (receipt)
        return this.finish(change, {
          base: view.current,
          candidate: view.candidate,
          status: input.range && !sameContent(view.current, view.candidate) ? 'pending' : 'accepted',
          authorEdited: true
        });
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
    return result;
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
          ordered.map(view =>
            applySnapshot(this.repository, {
              workId: input.workId,
              base: view.current,
              candidate: view.candidate,
              source: 'review'
            })
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
    return result;
  }

  /** 恢复只补齐已有作品回执的进度；未提交的意图清除，不继续执行旧修改。 */
  private recover(): void {
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
  private finish(change: PendingChange, fields: Partial<PendingChange>): PendingChange {
    const next = advanceChange(change, fields);
    this.repository.putPendingChange(next);
    return next;
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
    conflicted: view.conflicts.length > 0
  };
}
function titles(views: ReviewView[]): string {
  return views.map(view => `《${view.candidate.title}》`).join('、');
}
