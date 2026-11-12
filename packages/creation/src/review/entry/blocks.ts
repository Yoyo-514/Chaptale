import { sameAttributes } from '../../content/entries.ts';
import type { EntrySnapshot } from '../../contracts/content.ts';
import type { DecideReviewInput, EntryReviewView } from '../../contracts/review.ts';

/** 逐块决定正文的一处差异：拒绝时候选恢复正式原文，接受时返回写入该处后的正式稿。 */
export function decideBlock(
  view: EntryReviewView,
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
    a.position === b.position &&
    sameAttributes(a.attributes, b.attributes)
  );
}
