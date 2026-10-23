import { diff3Merge } from 'node-diff3';

import type { EntrySnapshot } from '../contracts/content.ts';
import type { PendingChange, ReviewView } from '../contracts/review.ts';
import { countDocumentWords } from '../text.ts';

/** 合并正式稿的后续修改，冲突区保留双方原文，不改写任何已保存快照。 */
export function mergeCandidate(change: PendingChange, current: EntrySnapshot | null): ReviewView {
  const conflicts = [...change.conflicts];
  const candidate = { ...change.candidate };
  if (change.base && current) {
    for (const field of ['title', 'format', 'parentId', 'position'] as const) {
      const original = change.base[field],
        official = current[field],
        proposed = candidate[field];
      if (official === original || official === proposed) continue;
      if (proposed === original) Object.assign(candidate, { [field]: official });
      else conflicts.push({ field, base: display(original), current: display(official), proposed: display(proposed) });
    }
    if (
      current.content !== change.base.content &&
      current.content !== candidate.content &&
      current.content !== null &&
      change.base.content !== null &&
      candidate.content !== null
    ) {
      let merged = '';
      for (const region of diff3Merge(
        current.content.split(''),
        change.base.content.split(''),
        candidate.content.split('')
      )) {
        if (region.ok) merged += region.ok.join('');
        else if (region.conflict) {
          const { a, b, o } = region.conflict;
          merged += b.join('');
          conflicts.push({ field: 'content', base: o.join(''), current: a.join(''), proposed: b.join('') });
        }
      }
      candidate.content = merged;
    }
  }
  candidate.wordCount = candidate.content === null ? 0 : countDocumentWords(candidate.content);
  return { change, current, candidate, conflicts };
}
function display(value: string | number | null): string | null {
  return value === null ? null : String(value);
}
