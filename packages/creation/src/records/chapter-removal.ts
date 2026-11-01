import type { Entry } from '../contracts/content.ts';
import type { RecordPlacement, RecordSource, StoryRecord } from '../contracts/records.ts';
import { chapterOrder } from '../contracts/records.ts';
import { relationState, type RelationState, type StoryRelation } from '../contracts/relations.ts';
import type { WorkRepository } from '../repository.ts';

/** 删除章节对故事资料的影响：随出处移走的事件、建立／结束，因发生位置失效而待重新定位的记录，以及状态改变的关系。 */
export interface ChapterRemoval {
  records: StoryRecord[];
  /** 建立／结束部分随章节移走的关系及被移走的 ID。 */
  milestones: { relation: StoryRelation; ids: string[] }[];
  /** 建立／结束全部随章节移走的关系，整条并入删除批次。 */
  relations: StoryRelation[];
  relocated: number;
  /** 按删除前的章节顺序，从 fromChapterId（可能是被删章节）起显示为 state；整条移走的关系不列出。 */
  changes: { relation: StoryRelation; fromChapterId: string; state: RelationState }[];
}

const fromChapters = (chapters: Set<string>) => (source: RecordSource) =>
  source.kind === 'chapter' && chapters.has(source.chapterId);
const placedIn = (chapters: Set<string>) => (placement: RecordPlacement) =>
  placement.kind === 'chapter' && chapters.has(placement.chapterId);

/** removed 为将进入回收站的条目 ID（含子项），entries 为删除前的正常目录。 */
export function chapterRemoval(work: WorkRepository, entries: readonly Entry[], removed: Set<string>): ChapterRemoval {
  const chapters = new Set(chapterOrder(entries).filter(id => removed.has(id)));
  const sourced = fromChapters(chapters);
  const placed = placedIn(chapters);
  const records = work.listRecords();
  const removal: ChapterRemoval = { records: [], milestones: [], relations: [], relocated: 0, changes: [] };
  for (const record of records) {
    if (sourced(record.source)) removal.records.push(record);
    else if (placed(record.placement)) removal.relocated++;
  }
  const order = chapterOrder(entries);
  for (const relation of work.listRelations()) {
    const ids = relation.milestones.filter(milestone => sourced(milestone.source)).map(milestone => milestone.id);
    removal.relocated += relation.milestones.filter(
      milestone => !sourced(milestone.source) && placed(milestone.placement)
    ).length;
    if (ids.length === relation.milestones.length) {
      removal.relations.push(relation);
      continue;
    }
    if (ids.length) removal.milestones.push({ relation, ids });
    // 按删除前的章节顺序比较，删除后待重新定位的建立／结束视同待定。
    const after = {
      milestones: relation.milestones
        .filter(milestone => !ids.includes(milestone.id))
        .map(milestone =>
          placed(milestone.placement) ? { ...milestone, placement: { kind: 'undetermined' as const } } : milestone
        )
    };
    const fromChapterId = order.find(
      chapter => relationState(relation, entries, chapter) !== relationState(after, entries, chapter)
    );
    if (fromChapterId)
      removal.changes.push({ relation, fromChapterId, state: relationState(after, entries, fromChapterId) });
  }
  return removal;
}

/** 在删除章节的同一事务与批次中移走随出处删除的事件与建立／结束。 */
export function trashChapterStory(work: WorkRepository, removal: ChapterRemoval, batchId: string, now: number): void {
  for (const record of removal.records) work.trashRecord(record.id, batchId, now);
  for (const { ids } of removal.milestones) work.trashMilestones(ids, batchId, now);
  for (const relation of removal.relations) {
    work.trashMilestones(
      relation.milestones.map(milestone => milestone.id),
      batchId,
      now
    );
    work.trashRelation(relation.id, batchId, now);
  }
}
