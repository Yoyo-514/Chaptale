import type { RecordSource, SourceReview } from '../contracts/records.ts';
import type { WorkRepository } from '../repository.ts';

/**
 * 出处核对：记录核对过的章节修订与章节当前正文比较，正文不同即待复核；只改标题或位置的修订正文相同，不触发。
 * 返回的判断函数在一次查询内缓存各修订正文。drafts 为审阅会话看到的章节修订（含待接受版本），出处正是该版本时不算改过。
 */
export function sourceChecker(
  work: WorkRepository,
  drafts: ReadonlyMap<string, string>
): (source: RecordSource) => boolean {
  const contents = new Map<string, string | null>();
  const content = (revisionId: string) => {
    if (!contents.has(revisionId)) contents.set(revisionId, work.getRevision(revisionId)?.snapshot.content ?? null);
    return contents.get(revisionId)!;
  };
  const current = new Map<string, string | null>();
  return source => {
    if (source.kind !== 'chapter') return false;
    if (drafts.get(source.chapterId) === source.revisionId) return false;
    if (!current.has(source.chapterId))
      current.set(source.chapterId, work.getDocument(source.chapterId)?.content ?? null);
    const now = current.get(source.chapterId)!;
    return now !== null && content(source.revisionId) !== now;
  };
}

/** 两个修订的正文是否相同。 */
export function sameContent(work: WorkRepository, a: string, b: string): boolean {
  return a === b || work.getRevision(a)?.snapshot.content === work.getRevision(b)?.snapshot.content;
}

/** 按出处章节汇总待复核的事件与关系建立／结束；章节顺序不定，由调用方排序。 */
export function sourceReviews(work: WorkRepository): SourceReview[] {
  const changed = sourceChecker(work, new Map());
  const byChapter = new Map<string, SourceReview & { createdAt: number }>();
  const add = (source: RecordSource, field: 'recordIds' | 'milestoneIds', id: string) => {
    if (source.kind !== 'chapter' || !changed(source)) return;
    const createdAt = work.getRevision(source.revisionId)!.createdAt;
    const review = byChapter.get(source.chapterId) ?? {
      chapterId: source.chapterId,
      recordIds: [],
      milestoneIds: [],
      earliestRevisionId: source.revisionId,
      createdAt
    };
    review[field].push(id);
    if (createdAt < review.createdAt) Object.assign(review, { earliestRevisionId: source.revisionId, createdAt });
    byChapter.set(source.chapterId, review);
  };
  for (const record of work.listRecords()) add(record.source, 'recordIds', record.id);
  for (const relation of work.listRelations())
    for (const milestone of relation.milestones) add(milestone.source, 'milestoneIds', milestone.id);
  return [...byChapter.values()].map(({ createdAt: _createdAt, ...review }) => review);
}
