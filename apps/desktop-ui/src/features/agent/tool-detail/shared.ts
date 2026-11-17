import type { ToolEntryTarget } from '../transcript';
import type { JsonRecord, ToolDetailContent, ToolDetailEdit, ToolDetailItem } from './types';

export function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

export function asRecords(list: unknown[]): JsonRecord[] {
  return list.map(item => asRecord(item)).filter((item): item is JsonRecord => Boolean(item));
}

export function sectionLabel(section: unknown): string | undefined {
  return section === 'resource' ? '资料' : section === 'manuscript' ? '文稿' : undefined;
}

export function writeStatusLabel(kind: unknown, pending?: unknown): string | undefined {
  if (kind === 'pending' || pending === true) return '待接受修改';
  if (kind === 'removed') return '已移除';
  if (kind === 'saved') return '已保存';
  return undefined;
}

export function wordsText(count: number) {
  return `${count.toLocaleString('en-US')} 字`;
}

export function entryTarget(entry: ToolEntryTarget): ToolEntryTarget {
  return { ...(entry.workId && { workId: entry.workId }), entryId: entry.entryId, title: entry.title };
}

export function extractEdits(input: JsonRecord | undefined): ToolDetailEdit[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input.edits)) {
    const list = asRecords(input.edits)
      .filter(item => typeof item.oldText === 'string' && typeof item.newText === 'string')
      .map(item => ({ oldText: item.oldText as string, newText: item.newText as string }));
    return list.length ? list : undefined;
  }
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    return [{ oldText: input.oldText, newText: input.newText }];
  }
  return undefined;
}

/** 列表类结果；没有条目时给出对应的空状态文案。 */
export function listContent(meta: string[], items: ToolDetailItem[], emptyText: string): ToolDetailContent {
  return { meta, items, ...(items.length === 0 && { emptyText }) };
}
