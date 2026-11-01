import type { PendingChange, RecordSource } from '../contracts.ts';

/** 判断某个候选所在作品中，哪些条目、事件、关系已被删除，哪些资料已无从接受。 */
export interface Removal {
  entry: (entryId: string) => boolean;
  record: (recordId: string) => boolean;
  relation: (relationId: string) => boolean;
  /** 资料既不在正式稿中，也没有本会话的新资料候选。 */
  missing: (resourceId: string) => boolean;
}

/**
 * 目标条目或候选父目录被删除的修改受影响；挂在受影响新建目录下的候选随之受影响。
 * 事件与关系候选在目标被删除、涉及的资料被删除或不再有可接受的新资料、出处章节被删除时受影响。
 */
export function affectedByRemoval(
  changes: PendingChange[],
  removedIn: (change: PendingChange) => Removal
): PendingChange[] {
  const affected: PendingChange[] = [];
  const removedCreated = new Set<string>();
  let remaining = changes;
  let found = true;
  while (found) {
    found = false;
    remaining = remaining.filter(change => {
      const removed = removedIn(change);
      const hit =
        change.target !== 'entry'
          ? removed[change.target](change.targetId) ||
            change.candidate.resourceIds.some(
              id => removed.entry(id) || removedCreated.has(id) || removed.missing(id)
            ) ||
            storySources(change).some(source => source.kind === 'chapter' && removed.entry(source.chapterId))
          : removed.entry(change.targetId) ||
            (change.candidate.parentId !== null &&
              (removed.entry(change.candidate.parentId) || removedCreated.has(change.candidate.parentId)));
      if (!hit) return true;
      affected.push(change);
      if (change.target === 'entry' && change.base === null) removedCreated.add(change.targetId);
      found = true;
      return false;
    });
  }
  return affected;
}

/** 事件或关系候选引用的出处。 */
export function storySources(change: Exclude<PendingChange, { target: 'entry' }>): RecordSource[] {
  return change.target === 'record'
    ? [change.candidate.source]
    : change.candidate.milestones.map(milestone => milestone.source);
}
