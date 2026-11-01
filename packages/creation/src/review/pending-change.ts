import { randomUUID } from 'node:crypto';

import type { EntrySnapshot } from '../contracts/content.ts';
import type { PendingChange, ReviewTarget, ReviewView } from '../contracts/review.ts';
import { countDocumentWords } from '../text.ts';

/** 候选每次演进都有新身份；作者开始处理后保留其版本，不允许 Agent 覆盖。 */
export function advanceChange<T extends PendingChange>(change: T, fields: Partial<T>): T {
  const version = randomUUID();
  const updatedAt = Date.now();
  const next: PendingChange = { ...change, ...fields, version, updatedAt };
  if (next.target === 'entry') {
    const { candidate } = next;
    next.candidate = {
      ...candidate,
      revisionId: version,
      updatedAt,
      wordCount: candidate.content === null ? 0 : countDocumentWords(candidate.content)
    };
  }
  return next as T;
}

/** 作者看到的版本仍是当前版本时返回 null，否则返回需要刷新的原因。 */
export function staleReason(view: ReviewView, input: ReviewTarget): string | null {
  if (view.change.status !== 'pending' || view.change.version !== input.expectedVersion)
    return '待接受修改已有新版本，请刷新后审阅';
  if ((view.current?.revisionId ?? null) !== input.expectedRevisionId) return '正式内容已有变化，请刷新审阅内容';
  if (view.change.target !== 'entry') return null;
  const current = view.current as EntrySnapshot | null;
  if (
    current &&
    (!input.expectedLocation ||
      input.expectedLocation.parentId !== current.parentId ||
      input.expectedLocation.position !== current.position)
  )
    return '正式目录位置已有变化，请刷新审阅内容';
  return null;
}

export function assertReviewTarget(view: ReviewView, input: ReviewTarget): void {
  const reason = staleReason(view, input);
  if (reason) throw new Error(reason);
}
