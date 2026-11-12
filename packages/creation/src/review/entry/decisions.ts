import { randomUUID } from 'node:crypto';

import { applySnapshot } from '../../content/commit.ts';
import { sameAttributes } from '../../content/entries.ts';
import { readEntrySnapshot } from '../../content/mutations.ts';
import type {
  DecideReviewInput,
  Entry,
  EntryChange,
  EntryReviewView,
  EntrySnapshot,
  PendingChange,
  ReviewTarget,
  UpdateReviewInput
} from '../../contracts.ts';
import type { CreationRepository, WorkRepository } from '../../repository.ts';
import type { CreationService } from '../../service.ts';
import { isStoryView, type ChangeLedger } from '../ledger.ts';
import { advanceChange } from '../pending-change.ts';
import { decideBlock, sameContent } from './blocks.ts';

export interface ReviewDecision {
  input: DecideReviewInput;
  parameters: readonly unknown[];
}

const attributeFields = new Set(['type', 'aliases', 'tags']);

/** 条目候选的审阅规则：整篇、单处正文、标题、资料属性与删除；在调用方的本机库事务中执行。 */
export class EntryReview {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly ledger: ChangeLedger;

  constructor(repository: CreationRepository, creation: CreationService, ledger: ChangeLedger) {
    this.repository = repository;
    this.creation = creation;
    this.ledger = ledger;
  }

  update(input: UpdateReviewInput): PendingChange {
    const view = this.checked(input);
    if ((view.candidate.kind !== 'document') !== (input.content === null)) throw new Error('候选正文与条目类型不符');
    const change = advanceChange(view.change, {
      base: view.current,
      candidate: { ...view.candidate, title: input.title, content: input.content },
      conflicts: input.resolveConflicts ? [] : view.conflicts,
      authorEdited: true
    });
    this.repository.library.putPendingChange(change);
    return change;
  }

  decide(change: EntryChange, decision: ReviewDecision): PendingChange {
    const { input, parameters } = decision;
    if (change.deleted) return this.decideDeletion(change, decision);
    if (this.repository.work(change.workId).readReceipt<Entry>(input.commandId, parameters))
      return this.recover(change, input);
    if (input.range && input.part) throw new Error('一次只能处理正文、标题或资料属性中的一项');
    const view = this.checked(input);
    if (input.part === 'title') return this.decideTitle(view, decision);
    if (input.part === 'attributes') return this.decideAttributes(view, decision);
    if (input.range) return this.decideRange(view, { ...decision, input: { ...input, range: input.range } });
    return this.decideWhole(view, decision);
  }

  /** 作品库已提交、本机进度未写入：按正式稿补齐进度。 */
  recover(change: EntryChange, input: DecideReviewInput): PendingChange {
    const view = this.ledger.entryView(change);
    const partial = input.range !== undefined || input.part !== undefined;
    return this.ledger.finish(change, {
      base: view.current,
      candidate: view.candidate,
      status: partial && !sameContent(view.current, view.candidate) ? 'pending' : 'accepted',
      authorEdited: true
    });
  }

  /** 整组接受中的一项，在调用方的作品库事务中写入。 */
  apply(work: WorkRepository, view: EntryReviewView): Entry[] {
    return view.change.deleted
      ? this.trash(work, [view.change])
      : [applySnapshot(work, { base: view.current, candidate: view.candidate, source: 'review' })];
  }

  /** 拒绝新建目录前，确认没有其他候选以它为父目录。 */
  assertUnreferenced(changes: EntryChange[], rejected: ReadonlySet<string>): void {
    const created = new Set(changes.filter(change => change.base === null).map(change => change.targetId));
    const referenced = this.ledger
      .pending(changes[0]?.workId ?? null, changes[0]?.sessionId ?? null)
      .some(
        other =>
          !rejected.has(other.id) &&
          other.target === 'entry' &&
          other.candidate.parentId !== null &&
          created.has(other.candidate.parentId)
      );
    if (referenced) throw new Error('请先处理引用此目录的待接受修改');
  }

  private decideDeletion(change: EntryChange, { input, parameters }: ReviewDecision): PendingChange {
    if (input.range !== undefined || input.part !== undefined) throw new Error('删除只能整篇接受或拒绝');
    const work = this.repository.work(change.workId);
    if (input.decision === 'accept' && !work.readReceipt(input.commandId, parameters)) {
      this.ledger.checked(input);
      this.creation.commit(change.workId, input.commandId, parameters, { kind: 'entries' }, () =>
        this.trash(work, [change])
      );
    }
    return this.ledger.finish(change, { status: settled(input) });
  }

  private decideTitle(view: EntryReviewView, decision: ReviewDecision): PendingChange {
    const { change, conflicts } = view;
    if (!view.current || view.current.title === view.candidate.title) throw new Error('这项修改没有改名可单独处理');
    let current = view.current;
    let candidate = view.candidate;
    if (decision.input.decision === 'accept') {
      if (conflicts.some(conflict => conflict.field === 'title')) throw new Error('标题有冲突，请先处理冲突再接受改名');
      // 只提交标题；正文与目录位置沿用正式稿，候选其余部分继续待审。
      current = this.accept(change, decision, current, { ...current, title: candidate.title })!;
    } else candidate = { ...candidate, title: current.title };
    return this.ledger.finish(change, {
      base: current,
      candidate,
      conflicts: conflicts.filter(conflict => conflict.field !== 'title'),
      authorEdited: true,
      status: sameContent(current, candidate) ? settled(decision.input) : 'pending'
    });
  }

  private decideAttributes(view: EntryReviewView, decision: ReviewDecision): PendingChange {
    const { change, conflicts } = view;
    if (
      !view.current?.attributes ||
      !view.candidate.attributes ||
      sameAttributes(view.current.attributes, view.candidate.attributes)
    )
      throw new Error('这项修改没有资料属性可单独处理');
    let current = view.current;
    let candidate = view.candidate;
    if (decision.input.decision === 'accept') {
      if (conflicts.some(conflict => attributeFields.has(conflict.field)))
        throw new Error('资料属性有冲突，请先处理冲突再接受');
      current = this.accept(change, decision, current, { ...current, attributes: candidate.attributes })!;
    } else candidate = { ...candidate, attributes: current.attributes };
    return this.ledger.finish(change, {
      base: current,
      candidate,
      conflicts: conflicts.filter(conflict => !attributeFields.has(conflict.field)),
      authorEdited: true,
      status: sameContent(current, candidate) ? settled(decision.input) : 'pending'
    });
  }

  private decideRange(
    view: EntryReviewView,
    decision: ReviewDecision & { input: DecideReviewInput & { range: NonNullable<DecideReviewInput['range']> } }
  ): PendingChange {
    const block = decideBlock(view, decision.input);
    const current = block.accepted ? this.accept(view.change, decision, view.current, block.accepted) : view.current;
    return this.ledger.finish(view.change, {
      base: current,
      candidate: block.candidate,
      conflicts: view.conflicts,
      authorEdited: true,
      status: sameContent(current, block.candidate) ? settled(decision.input) : 'pending'
    });
  }

  private decideWhole(view: EntryReviewView, decision: ReviewDecision): PendingChange {
    const { change } = view;
    if (decision.input.decision === 'accept') {
      if (view.conflicts.length) throw new Error('请先处理冲突，再接受修改');
      this.accept(change, decision, view.current, view.candidate);
    } else this.assertUnreferenced([change], new Set([change.id]));
    return this.ledger.finish(change, { status: settled(decision.input) });
  }

  /** 把接受的内容提交为正式修订，返回提交后的正式稿。 */
  private accept(
    change: EntryChange,
    { input, parameters }: ReviewDecision,
    base: EntrySnapshot | null,
    candidate: EntrySnapshot
  ): EntrySnapshot | null {
    this.creation.commitSnapshot({
      workId: change.workId,
      commandId: input.commandId,
      parameters,
      base,
      candidate,
      source: 'review'
    });
    return readEntrySnapshot(this.repository.work(change.workId), change.targetId);
  }

  private trash(work: WorkRepository, changes: EntryChange[]): Entry[] {
    const entries = work.listEntries();
    const ids = new Set(
      work.trashEntries(
        changes.map(change => change.targetId),
        randomUUID(),
        Date.now()
      )
    );
    return entries.filter(entry => ids.has(entry.id));
  }

  private checked(input: ReviewTarget): EntryReviewView {
    const view = this.ledger.checked(input);
    if (isStoryView(view)) throw new Error('事件与关系只能整条接受或拒绝');
    return view;
  }
}

export function settled(input: DecideReviewInput): 'accepted' | 'rejected' {
  return input.decision === 'accept' ? 'accepted' : 'rejected';
}
