import { asRecord, asRecords, entryTarget, listContent, sectionLabel } from './shared';
import { recordItem, relationItem } from './story';
import type { JsonRecord, ToolDetailContent, ToolDetailItem, WorkToolCall } from './types';

/** 命中来自关键词、语义还是两者；语义命中附相似度。 */
function sourceLabel(hit: JsonRecord): string {
  if (hit.matchedBy === 'keyword') return '关键词';
  const similarity = typeof hit.similarity === 'number' ? ` · 相似度 ${hit.similarity.toFixed(2)}` : '';
  return `${hit.matchedBy === 'both' ? '两者' : '语义'}${similarity}`;
}

/** 命中的文稿或资料：每段原文一行，没有段落时只列条目。source 只在这次检索带了问题时给出。 */
function entryItems(hit: JsonRecord, index: number, source: string[]): ToolDetailItem[] {
  const entry = asRecord(hit.entry);
  if (!entry) return [];
  const entryId = typeof entry.entryId === 'string' ? entry.entryId : String(index);
  const title = typeof entry.title === 'string' ? entry.title : '未命名';
  const workId = typeof entry.workId === 'string' ? entry.workId : undefined;
  const head = entry.kind === 'document' ? { target: entryTarget({ workId, entryId, title }) } : { label: title };
  const flags: string[] = [...source];
  if (hit.pending === true) flags.push('待审');
  if (hit.ignoresAsOf === true) flags.push('不随进度');
  const passages = Array.isArray(hit.passages) ? asRecords(hit.passages) : [];
  if (!passages.length) {
    const kind = entry.kind === 'file' ? '文件' : sectionLabel(entry.section);
    return [{ key: entryId, ...head, meta: [...(kind ? [kind] : []), '名称命中', ...flags].join(' · ') }];
  }
  return passages.map(passage => {
    const { startLine, endLine } = passage;
    const lines =
      startLine === endLine ? `第 ${String(startLine)} 行` : `第 ${String(startLine)}–${String(endLine)} 行`;
    return {
      key: `${entryId}:${String(startLine)}`,
      ...head,
      meta: [lines, ...flags].join(' · '),
      ...(typeof passage.text === 'string' && { snippet: passage.text })
    };
  });
}

/** work_search：按相关度排列的原文段落、事件和关系。 */
export function searchDetail({ input, value, lookup }: WorkToolCall): ToolDetailContent {
  const page = asRecord(value);
  const meta: string[] = [];
  // 只按关键词检索时每条命中的来源都一样，不逐条标。
  const semantic = typeof input?.question === 'string';
  if (semantic && typeof input?.query === 'string') meta.push(`问题：${String(input.question)}`);
  const asOf = typeof input?.asOf === 'string' ? lookup?.(input.asOf) : undefined;
  if (asOf) meta.push(`只到《${asOf.title}》`);
  if (page?.hasMore === true) meta.push('还有更多结果');
  if (typeof page?.notice === 'string') meta.push(page.notice);
  if (typeof page?.embedded === 'number') meta.push(`补算了 ${String(page.embedded)} 段向量`);
  if (!Array.isArray(page?.hits)) return { meta };
  const items = asRecords(page.hits).flatMap((hit, index): ToolDetailItem[] => {
    const source = semantic ? [sourceLabel(hit)] : [];
    const sourced = (item: ToolDetailItem): ToolDetailItem => ({
      ...item,
      meta: [...(item.meta ? [item.meta] : []), ...source].join(' · ')
    });
    const record = asRecord(hit.record);
    if (hit.kind === 'record' && record) return [sourced(recordItem(record, index, lookup))];
    const relation = asRecord(hit.relation);
    if (hit.kind === 'relation' && relation) return [sourced(relationItem(relation, index, lookup))];
    return entryItems(hit, index, source);
  });
  return listContent(meta, items, '无匹配内容');
}
