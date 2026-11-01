import {
  chapterOrder,
  type Entry,
  type EntryChange,
  type RecordPlacement,
  type RecordSource,
  type RelationFields,
  type RelationMilestone
} from '@chaptale/creation/contracts';

function chapterTitle(entries: readonly Entry[], chapterId: string) {
  const title = entries.find(entry => entry.id === chapterId)?.title;
  return title === undefined ? '已删除的章节' : `《${title}》`;
}

export function placementLabel(placement: RecordPlacement, entries: readonly Entry[]) {
  if (placement.kind === 'opening') return '开篇之前';
  if (placement.kind === 'undetermined') return '待定';
  return chapterTitle(entries, placement.chapterId);
}

export function sourceLabel(source: RecordSource, entries: readonly Entry[]) {
  return source.kind === 'author' ? '作者补充' : `出自${chapterTitle(entries, source.chapterId)}`;
}

/** 选择框的值：章节 ID，或 opening、undetermined。 */
export function placementValue(placement: RecordPlacement) {
  return placement.kind === 'chapter' ? placement.chapterId : placement.kind;
}
export function placementFrom(value: string): RecordPlacement {
  return value === 'opening' || value === 'undetermined' ? { kind: value } : { kind: 'chapter', chapterId: value };
}

/** 本资料在关系中的视角：对方资料、双方称呼。 */
export function relationSide(relation: Pick<RelationFields, 'resourceIds' | 'titles'>, resourceId: string) {
  const side = relation.resourceIds[0] === resourceId ? 0 : 1;
  return {
    otherId: relation.resourceIds[1 - side],
    ownTitle: relation.titles[side],
    otherTitle: relation.titles[1 - side]
  };
}

/** 事件列表与关系详情中建立或结束的文字，如“成为顾长风的徒弟”“与顾长风的师徒关系结束”。 */
export function milestoneText(
  relation: Pick<RelationFields, 'resourceIds' | 'titles' | 'type'>,
  resourceId: string,
  kind: RelationMilestone['kind'],
  otherName: string
) {
  return kind === 'start'
    ? `成为${otherName}的${relationSide(relation, resourceId).ownTitle}`
    : `与${otherName}的${relation.type}关系结束`;
}

/**
 * 起止章节：最早一次建立与最后一次结束（结束晚于最后一次建立时），位置待定的不计；
 * asOf 为章节 ID 时只看截至该章的建立与结束。
 */
export function relationSpan(
  relation: Pick<RelationFields, 'milestones'>,
  entries: readonly Entry[],
  asOf: string | null = null
) {
  const chapters = chapterOrder(entries);
  const limit = asOf === null ? Number.MAX_SAFE_INTEGER : chapters.indexOf(asOf);
  const rank = (placement: RecordPlacement) => {
    if (placement.kind === 'undetermined') return null;
    if (placement.kind === 'opening') return -1;
    const index = chapters.indexOf(placement.chapterId);
    return index === -1 ? chapters.length : index;
  };
  const placed = relation.milestones
    .map(milestone => ({ milestone, rank: rank(milestone.placement) }))
    .filter((item): item is { milestone: RelationMilestone; rank: number } => item.rank !== null && item.rank <= limit)
    .toSorted((a, b) => a.rank - b.rank);
  const start = placed.find(item => item.milestone.kind === 'start');
  const last = placed.at(-1);
  if (!start) return '';
  const end = last && last.milestone.kind === 'end' && last.rank >= start.rank ? last : null;
  const startLabel = placementLabel(start.milestone.placement, entries);
  if (!end) return `${startLabel}起`;
  const endLabel = placementLabel(end.milestone.placement, entries);
  return endLabel === startLabel ? `${startLabel}起止` : `${startLabel}起 至${endLabel}止`;
}

/** 资料名称：正式资料或待接受的新资料；已删除时为 null。 */
export function resourceTitle(id: string, entries: readonly Entry[], pendingEntries: readonly EntryChange[]) {
  return (
    entries.find(entry => entry.id === id)?.title ??
    pendingEntries.find(change => change.targetId === id)?.candidate.title ??
    null
  );
}

/** 事件列表中的一条关系变化，点击定位到关系块对应行。 */
export interface MilestoneRow {
  key: string;
  relationId: string;
  placement: RecordPlacement;
  text: string;
  storyTime: string;
  pending: boolean;
}
