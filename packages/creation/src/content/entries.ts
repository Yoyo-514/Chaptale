import { isImageFile, type Entry, type ResourceAttributes } from '../contracts/content.ts';

/** 新建条目的属性：资料文档从空属性开始，文稿与目录没有属性。 */
export function initialAttributes(entry: Pick<Entry, 'section' | 'kind'>): ResourceAttributes | null {
  return entry.section === 'resource' && entry.kind === 'document'
    ? { type: '', aliases: [], tags: [], cover: null }
    : null;
}

/** 封面只能是资料区的图片文件条目；沿用已失效的封面不再校验。 */
export function assertCover(entries: Entry[], cover: string | null, previous: string | null): void {
  if (cover === null || cover === previous) return;
  const entry = entries.find(item => item.id === cover);
  if (!entry || entry.section !== 'resource' || !isImageFile(entry)) throw new Error('封面需要选择资料中的图片');
}

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
