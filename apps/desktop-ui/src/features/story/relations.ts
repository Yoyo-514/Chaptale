import {
  relationState,
  type Entry,
  type EntryChange,
  type RelationChange,
  type RelationMilestone,
  type RelationSnapshot,
  type RelationState,
  type StoryRelation
} from '@chaptale/creation/contracts';

import { milestoneText, placementLabel, placementValue, resourceTitle, type MilestoneRow } from './labels';

/** 资料页的一条关系：正式关系，或叠加本会话候选后的内容。 */
export interface RelationItem {
  relation: RelationSnapshot;
  /** 正式修订，新增候选为 null。 */
  revisionId: string | null;
  change: RelationChange | null;
}

/** 涉及本资料的正式关系与候选；候选按正式关系的顺序显示，新关系排在末尾。 */
export function relationItems(
  relations: readonly StoryRelation[],
  candidates: readonly RelationChange[],
  resourceId: string
): RelationItem[] {
  const changes = new Map(candidates.map(change => [change.targetId, change]));
  const items: RelationItem[] = relations
    .filter(relation => relation.resourceIds.includes(resourceId) || changes.has(relation.id))
    .map(relation => ({
      relation: changes.get(relation.id)?.candidate ?? relation,
      revisionId: relation.revisionId,
      change: changes.get(relation.id) ?? null
    }));
  for (const change of candidates)
    if (!relations.some(relation => relation.id === change.targetId))
      items.push({ relation: change.candidate, revisionId: null, change });
  return items;
}

/** 截至查看进度的状态；全部建立／结束都在查看进度之后的关系不显示。 */
export function relationVisibility(
  relation: RelationSnapshot,
  entries: readonly Entry[],
  asOf: string | null
): RelationState | null {
  const state = relationState(relation, entries, asOf);
  const placed = relation.milestones.some(milestone => milestone.placement.kind !== 'undetermined');
  return state === 'undetermined' && placed && asOf !== null ? null : state;
}

/** 事件列表穿插的建立／结束；移除整条关系的候选不再穿插。 */
export function milestoneRows(
  items: readonly RelationItem[],
  resourceId: string,
  entries: readonly Entry[],
  pendingEntries: readonly EntryChange[]
): MilestoneRow[] {
  return items.flatMap(({ relation, change }) => {
    if (change?.deleted || !relation.resourceIds.includes(resourceId)) return [];
    const otherId = relation.resourceIds.find(id => id !== resourceId) ?? resourceId;
    const name = resourceTitle(otherId, entries, pendingEntries) ?? '已删除的资料';
    return relation.milestones.map(milestone => ({
      key: `${relation.id}:${milestone.id}`,
      relationId: relation.id,
      placement: milestone.placement,
      text: milestoneText(relation, resourceId, milestone.kind, name),
      storyTime: milestone.storyTime,
      pending: change !== null
    }));
  });
}

/** 关系候选相对底稿的变化，逐行列出改动的字段与建立／结束。 */
export function relationDiff(
  base: RelationSnapshot | null,
  candidate: RelationSnapshot,
  entries: readonly Entry[]
): { kind: 'added' | 'removed' | 'changed'; text: string }[] {
  const describe = (milestone: RelationMilestone) =>
    [milestone.kind === 'start' ? '建立' : '结束', placementLabel(milestone.placement, entries), milestone.storyTime]
      .filter(Boolean)
      .join(' · ');
  if (!base) return candidate.milestones.map(milestone => ({ kind: 'added', text: describe(milestone) }));
  const lines: { kind: 'added' | 'removed' | 'changed'; text: string }[] = [];
  if (base.type !== candidate.type || base.directed !== candidate.directed)
    lines.push({ kind: 'changed', text: `类型：${base.type} → ${candidate.type}` });
  if (base.titles.join() !== candidate.titles.join())
    lines.push({ kind: 'changed', text: `称呼：${base.titles.join('／')} → ${candidate.titles.join('／')}` });
  for (const milestone of candidate.milestones) {
    const before = base.milestones.find(item => item.id === milestone.id);
    if (!before) lines.push({ kind: 'added', text: describe(milestone) });
    else if (
      before.kind !== milestone.kind ||
      placementValue(before.placement) !== placementValue(milestone.placement) ||
      before.storyTime !== milestone.storyTime
    )
      lines.push({ kind: 'changed', text: `${describe(before)} → ${describe(milestone)}` });
  }
  for (const milestone of base.milestones)
    if (!candidate.milestones.some(item => item.id === milestone.id))
      lines.push({ kind: 'removed', text: describe(milestone) });
  return lines;
}
