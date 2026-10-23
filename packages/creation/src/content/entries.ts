import type { Entry } from '../contracts/content.ts';

/** 目录身份、内容区域与无环约束对作者和 Agent 一致。 */
export function assertEntryParent(entries: Entry[], candidate: Pick<Entry, 'id' | 'parentId' | 'section'>): void {
  if (candidate.parentId === null) return;
  let parent = entries.find(entry => entry.id === candidate.parentId);
  if (!parent || parent.kind !== 'directory' || parent.section !== candidate.section)
    throw new Error('目标目录不存在或不属于当前内容区域');
  while (parent) {
    if (parent.id === candidate.id) throw new Error('目录不能移入自身或子目录');
    const ancestorId: string | null = parent.parentId;
    parent = entries.find(entry => entry.id === ancestorId);
  }
}
