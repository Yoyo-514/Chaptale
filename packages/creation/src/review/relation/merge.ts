import type { RelationMilestone, RelationSnapshot, StoryRelation } from '../../contracts/relations.ts';
import type { RelationChange, RelationReviewView } from '../../contracts/review.ts';

const fields = ['resourceIds', 'type', 'directed', 'titles'] as const;

/**
 * 关系按候选底稿、正式稿和候选三方合并：关系字段逐个比较，建立／结束按 ID 逐条比较。
 * 只有一方改过的采用改过的值，正式稿后来新增的建立／结束保留；双方改得不同记为冲突，候选保留自己的值。
 */
export function mergeRelation(change: RelationChange, current: StoryRelation | null): RelationReviewView {
  const conflicts = [...change.conflicts];
  if (!change.base || !current) return { change, current, candidate: change.candidate, conflicts };
  const base = change.base,
    official = relationSnapshot(current),
    proposed = change.candidate;
  const candidate: RelationSnapshot = { ...proposed };
  for (const field of fields) {
    const original = display(base[field]),
      now = display(official[field]),
      next = display(proposed[field]);
    if (now === original || now === next) continue;
    if (next === original) Object.assign(candidate, { [field]: official[field] });
    else conflicts.push({ field, base: original, current: now, proposed: next });
  }
  if (display(official.milestones) !== display(base.milestones)) {
    const find = (list: RelationMilestone[], id: string) => list.find(item => item.id === id);
    const merged = new Map<string, RelationMilestone | undefined>();
    const ids = [...new Set([...proposed.milestones, ...official.milestones, ...base.milestones].map(item => item.id))];
    for (const id of ids) {
      const original = find(base.milestones, id),
        now = find(official.milestones, id),
        next = find(proposed.milestones, id);
      const [a, b, c] = [original, now, next].map(item => (item ? display(item) : null));
      if (b === a || b === c) merged.set(id, next);
      else if (c === a) merged.set(id, now);
      else {
        merged.set(id, next);
        conflicts.push({ field: 'milestone', milestoneId: id, base: a, current: b, proposed: c });
      }
    }
    candidate.milestones = ids.flatMap(id => merged.get(id) ?? []);
  }
  return { change, current, candidate, conflicts };
}

export function relationSnapshot(relation: StoryRelation): RelationSnapshot {
  const { id, resourceIds, type, directed, titles, milestones } = relation;
  return { id, resourceIds, type, directed, titles, milestones };
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
