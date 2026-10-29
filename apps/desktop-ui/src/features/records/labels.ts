import type { Entry, RecordPlacement, RecordSource } from '@chaptale/creation/contracts';

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
