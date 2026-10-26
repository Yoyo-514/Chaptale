import { randomUUID } from 'node:crypto';

import type { EntrySnapshot } from '../contracts/content.ts';
import type { DecideReviewInput, PendingChange, ReviewTarget, ReviewView } from '../contracts/review.ts';
import { countDocumentWords } from '../text.ts';

/** 候选每次演进都有新身份；作者开始处理后保留其版本，不允许 Agent 覆盖。 */
export function advanceChange(change: PendingChange, fields: Partial<PendingChange>): PendingChange {
  const version = randomUUID();
  const updatedAt = Date.now();
  const candidate = fields.candidate ?? change.candidate;
  return {
    ...change,
    ...fields,
    version,
    candidate: {
      ...candidate,
      revisionId: version,
      updatedAt,
      wordCount: candidate.content === null ? 0 : countDocumentWords(candidate.content)
    },
    updatedAt
  };
}

/** 作者看到的版本仍是当前版本时返回 null，否则返回需要刷新的原因。 */
export function staleReason(view: ReviewView, input: ReviewTarget): string | null {
  if (view.change.status !== 'pending' || view.change.version !== input.expectedVersion)
    return '待接受修改已有新版本，请刷新后审阅';
  if ((view.current?.revisionId ?? null) !== input.expectedRevisionId) return '正式内容已有变化，请刷新审阅内容';
  if (
    view.current &&
    (!input.expectedLocation ||
      input.expectedLocation.parentId !== view.current.parentId ||
      input.expectedLocation.position !== view.current.position)
  )
    return '正式目录位置已有变化，请刷新审阅内容';
  return null;
}

export function assertReviewTarget(view: ReviewView, input: ReviewTarget): void {
  const reason = staleReason(view, input);
  if (reason) throw new Error(reason);
}

export function decideBlock(
  view: ReviewView,
  input: DecideReviewInput & { range: NonNullable<DecideReviewInput['range']> }
): { candidate: EntrySnapshot; accepted: EntrySnapshot | null } {
  const { candidate, current } = view;
  if (!current || current.content === null || candidate.content === null)
    throw new Error('逐块审阅只适用于已有正文；新建和目录修改请整体处理');
  const { fromA, toA, fromB, toB } = input.range;
  if (fromA > toA || fromB > toB || toA > current.content.length || toB > candidate.content.length)
    throw new Error('审阅块超出正文范围');
  if (input.decision === 'reject')
    return {
      candidate: {
        ...candidate,
        content: candidate.content.slice(0, fromB) + current.content.slice(fromA, toA) + candidate.content.slice(toB)
      },
      accepted: null
    };
  if (view.conflicts.length) throw new Error('请先处理冲突，再接受修改');
  return {
    candidate,
    accepted: {
      ...current,
      content: current.content.slice(0, fromA) + candidate.content.slice(fromB, toB) + current.content.slice(toA)
    }
  };
}

export function sameContent(a: EntrySnapshot | null, b: EntrySnapshot): boolean {
  return (
    a !== null &&
    a.title === b.title &&
    a.content === b.content &&
    a.format === b.format &&
    a.parentId === b.parentId &&
    a.position === b.position
  );
}
