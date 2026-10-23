import { commitSnapshot } from '../content/commit.ts';
import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  DecideReviewInput,
  Entry,
  PendingChange,
  ReviewTarget,
  ReviewView,
  UpdateReviewInput
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';
import { mergeCandidate } from './merge.ts';
import { advanceChange, assertReviewTarget, decideBlock, sameContent } from './pending-change.ts';

/** 审阅用例只协调候选决策、正式提交与中断恢复。 */
export class ReviewService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  constructor(repository: CreationRepository, creation: CreationService) {
    this.repository = repository;
    this.creation = creation;
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

  /** 恢复只补齐已有作品回执的进度；未提交的意图清除，不继续执行旧修改。 */
  private recover(): void {
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
