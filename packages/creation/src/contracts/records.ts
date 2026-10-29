import type { Entry } from './content.ts';

/** 事件发生在哪：某一章、开篇之前，或作者尚未决定。 */
export type RecordPlacement = { kind: 'chapter'; chapterId: string } | { kind: 'opening' } | { kind: 'undetermined' };
/** 写到这件事的章节及核对过的正文修订；作者先写的事件标为作者补充。 */
export type RecordSource = { kind: 'chapter'; chapterId: string; revisionId: string } | { kind: 'author' };

/** 一次事件修订保存的内容；顺序不进入修订。 */
export interface RecordSnapshot {
  id: string;
  /** 涉及的资料，至少一份，按作者给出的顺序显示。 */
  resourceIds: string[];
  text: string;
  source: RecordSource;
  placement: RecordPlacement;
  /** 作者标注的故事内时间，空字符串表示未标注；不参与排序。 */
  storyTime: string;
}
export type RecordFields = Omit<RecordSnapshot, 'id'>;

export interface StoryRecord extends RecordSnapshot {
  /** 同一发生位置内的全作品顺序，从 0 开始连续编号。 */
  position: number;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRecordInput extends RecordFields {
  commandId: string;
  workId: string;
}
export interface UpdateRecordInput extends RecordFields {
  commandId: string;
  workId: string;
  recordId: string;
  expectedRevisionId: string;
}
/** 插到 beforeId 之前；为 null 时排到同一发生位置末尾。 */
export interface MoveRecordInput {
  commandId: string;
  workId: string;
  recordId: string;
  beforeId: string | null;
}
export interface RemoveRecordInput {
  commandId: string;
  workId: string;
  recordId: string;
  expectedRevisionId: string;
}

/** 文稿区按目录树先序排列的文稿即章节顺序。 */
export function chapterOrder(entries: readonly Entry[]): string[] {
  const children = new Map<string | null, Entry[]>();
  for (const entry of entries) {
    if (entry.section !== 'manuscript') continue;
    const list = children.get(entry.parentId) ?? [];
    list.push(entry);
    children.set(entry.parentId, list);
  }
  const order: string[] = [];
  const visit = (parentId: string | null): void => {
    for (const entry of (children.get(parentId) ?? []).sort((a, b) => a.position - b.position)) {
      if (entry.kind === 'document') order.push(entry.id);
      else if (entry.kind === 'directory') visit(entry.id);
    }
  };
  visit(null);
  return order;
}

const placementKey = (placement: RecordPlacement): string =>
  placement.kind === 'chapter' ? `chapter:${placement.chapterId}` : placement.kind;

export interface RecordGroup {
  placement: RecordPlacement;
  records: StoryRecord[];
}

/**
 * 按发生位置分组：开篇之前、各章（章节顺序）、章节已不在文稿区的位置、待定。
 * asOf 为章节 ID 时只保留截至该章发生的事件，待定事件始终列出。
 */
export function groupRecords(
  records: readonly StoryRecord[],
  entries: readonly Entry[],
  asOf: string | null = null
): RecordGroup[] {
  const chapters = chapterOrder(entries);
  const limit = asOf === null ? chapters.length : chapters.indexOf(asOf) + 1;
  const groups = new Map<string, RecordGroup>();
  for (const record of [...records].sort((a, b) => a.position - b.position)) {
    const id = placementKey(record.placement);
    const group = groups.get(id) ?? { placement: record.placement, records: [] };
    group.records.push(record);
    groups.set(id, group);
  }
  const rank = (placement: RecordPlacement): number => {
    if (placement.kind === 'opening') return -1;
    if (placement.kind === 'undetermined') return Number.MAX_SAFE_INTEGER;
    const index = chapters.indexOf(placement.chapterId);
    return index === -1 ? chapters.length : index;
  };
  return [...groups.values()]
    .filter(group => {
      if (asOf === null || group.placement.kind !== 'chapter') return true;
      const index = chapters.indexOf(group.placement.chapterId);
      return index !== -1 && index < limit;
    })
    .sort((a, b) => rank(a.placement) - rank(b.placement));
}
