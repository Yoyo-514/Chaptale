import { readEntrySnapshot } from '../content/mutations.ts';
import type {
  EntryChange,
  EntryReviewView,
  PendingChange,
  RecordChange,
  RecordReviewView,
  RelationChange,
  RelationReviewView,
  ReviewTarget,
  ReviewView
} from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import { mergeCandidate } from './entry/merge.ts';
import { advanceChange, assertReviewTarget } from './pending-change.ts';
import { mergeRecord, recordSnapshot } from './record/merge.ts';
import { mergeRelation, relationSnapshot } from './relation/merge.ts';

/** 事件与关系候选：整条审阅，可依赖本会话新资料候选。 */
export type StoryChange = RecordChange | RelationChange;
export type StoryView = RecordReviewView | RelationReviewView;

/** 候选台账：读取候选、合并正式稿得到审阅视图、校验作者看到的版本并推进候选状态。 */
export class ChangeLedger {
  private readonly repository: CreationRepository;

  constructor(repository: CreationRepository) {
    this.repository = repository;
  }

  get(id: string): PendingChange {
    const change = this.repository.library.getPendingChange(id);
    if (!change) throw new Error('待接受修改不存在');
    return change;
  }

  /** 尚待处理的候选；不触发恢复。 */
  pending(workId: string | null, sessionId: string | null): PendingChange[] {
    return this.repository.library.listPendingChanges(workId, sessionId);
  }

  view(change: PendingChange): ReviewView {
    if (change.target === 'entry') return this.entryView(change);
    return change.target === 'record' ? this.recordView(change) : this.relationView(change);
  }
  entryView(change: EntryChange): EntryReviewView {
    return mergeCandidate(change, readEntrySnapshot(this.repository.work(change.workId), change.targetId));
  }
  recordView(change: RecordChange): RecordReviewView {
    return mergeRecord(change, this.repository.work(change.workId).getRecord(change.targetId) ?? null);
  }
  relationView(change: RelationChange): RelationReviewView {
    return mergeRelation(change, this.repository.work(change.workId).getRelation(change.targetId) ?? null);
  }

  checked(input: ReviewTarget): ReviewView {
    const view = this.view(this.get(input.changeId));
    assertReviewTarget(view, input);
    return view;
  }

  /** 删除候选结束时处理并入的修改：接受则一并拒绝，拒绝则恢复待审。 */
  finish<T extends PendingChange>(change: T, fields: Partial<T>): T {
    const next = advanceChange(change, fields);
    this.repository.library.putPendingChange(next);
    if (next.target === 'entry' && next.deleted && next.status !== 'pending')
      for (const id of next.covers ?? []) {
        const covered = this.repository.library.getPendingChange(id);
        if (covered?.status === 'covered')
          this.repository.library.putPendingChange(
            advanceChange(covered, { status: next.status === 'accepted' ? 'rejected' : 'pending' })
          );
      }
    return next;
  }

  /** 正式稿已写入后，以正式稿为基线把候选记为已接受。 */
  finishAccepted(change: PendingChange): PendingChange {
    if (change.target === 'record') {
      const view = this.recordView(change);
      return this.finish(change, {
        base: view.current ? recordSnapshot(view.current) : change.base,
        candidate: view.candidate,
        status: 'accepted'
      });
    }
    if (change.target === 'relation') {
      const view = this.relationView(change);
      return this.finish(change, {
        base: view.current ? relationSnapshot(view.current) : change.base,
        candidate: view.candidate,
        status: 'accepted'
      });
    }
    const view = this.entryView(change);
    return this.finish(change, { base: view.current, candidate: view.candidate, status: 'accepted' });
  }
}

export function isStoryView(view: ReviewView): view is StoryView;
export function isStoryView<K extends StoryChange['target']>(
  view: ReviewView,
  target: K
): view is Extract<StoryView, { change: { target: K } }>;
export function isStoryView(view: ReviewView, target?: StoryChange['target']): boolean {
  return target === undefined ? view.change.target !== 'entry' : view.change.target === target;
}
