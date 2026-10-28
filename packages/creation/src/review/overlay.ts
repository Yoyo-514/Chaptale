import type { Entry } from '../contracts/content.ts';
import type { ReviewView } from '../contracts/review.ts';

/** 按结构修改的先后构造会话目录；正文修改不携带其他候选造成的位置变化。 */
export function overlayEntries(formal: Entry[], views: ReviewView[]): Entry[] {
  const entries = new Map(formal.map(entry => [entry.id, { ...entry }]));
  // oxlint-disable-next-line unicorn/no-array-sort
  const ordered = [...views].sort((a, b) => a.change.order - b.change.order);
  for (const { change, candidate } of ordered) {
    if (change.deleted) {
      // 删除候选在会话目录中隐藏目标及其子项。
      const removed = new Set([candidate.id]);
      for (let size = 0; size !== removed.size;) {
        size = removed.size;
        for (const entry of entries.values())
          if (entry.parentId !== null && removed.has(entry.parentId)) removed.add(entry.id);
      }
      const parentId = entries.get(candidate.id)?.parentId;
      for (const id of removed) entries.delete(id);
      if (parentId !== undefined) normalize(entries, candidate.section, parentId);
      continue;
    }
    const { content: _content, ...metadata } = candidate;
    const previous = entries.get(candidate.id);
    const moved =
      change.base === null ||
      candidate.parentId !== change.base.parentId ||
      candidate.position !== change.base.position;
    entries.set(
      candidate.id,
      previous ? { ...metadata, parentId: previous.parentId, position: previous.position } : metadata
    );
    if (!moved) continue;
    const sourceParent = previous?.parentId;
    if (previous) reorder(entries, candidate.section, previous.parentId, candidate.id, null);
    const destination = entries.get(candidate.id)!;
    destination.parentId = candidate.parentId;
    reorder(entries, candidate.section, candidate.parentId, candidate.id, candidate.position);
    if (sourceParent !== undefined && sourceParent !== candidate.parentId)
      normalize(entries, candidate.section, sourceParent);
  }
  return [...entries.values()];
}
function siblings(entries: Map<string, Entry>, section: Entry['section'], parentId: string | null, except: string) {
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...entries.values()]
    .filter(entry => entry.section === section && entry.parentId === parentId && entry.id !== except)
    .sort((a, b) => a.position - b.position);
}
function reorder(
  entries: Map<string, Entry>,
  section: Entry['section'],
  parentId: string | null,
  id: string,
  position: number | null
): void {
  const group = siblings(entries, section, parentId, id);
  if (position !== null) group.splice(position, 0, entries.get(id)!);
  group.forEach((entry, index) => {
    entry.position = index;
  });
}
function normalize(entries: Map<string, Entry>, section: Entry['section'], parentId: string | null): void {
  const group = siblings(entries, section, parentId, '');
  group.forEach((entry, index) => {
    entry.position = index;
  });
}
