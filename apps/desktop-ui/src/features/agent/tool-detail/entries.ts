import {
  asRecord,
  asRecords,
  entryTarget,
  extractEdits,
  listContent,
  sectionLabel,
  wordsText,
  writeStatusLabel
} from './shared';
import type { JsonRecord, ToolDetailContent, ToolDetailItem, WorkToolCall } from './types';

function appendAttributesMeta(meta: string[], attributes: unknown) {
  const attr = asRecord(attributes);
  if (!attr) return;
  if (typeof attr.type === 'string' && attr.type) meta.push(`类型：${attr.type}`);
  if (Array.isArray(attr.aliases) && attr.aliases.length) {
    meta.push(`别名：${attr.aliases.filter((a): a is string => typeof a === 'string' && Boolean(a)).join('、')}`);
  }
  if (Array.isArray(attr.tags) && attr.tags.length) {
    meta.push(`标签：${attr.tags.filter((t): t is string => typeof t === 'string' && Boolean(t)).join('、')}`);
  }
}

function mapEntryItem(entry: JsonRecord, index: number): ToolDetailItem {
  const entryId = typeof entry.entryId === 'string' ? entry.entryId : typeof entry.id === 'string' ? entry.id : '';
  const title = typeof entry.title === 'string' ? entry.title : '未命名';
  const workId = typeof entry.workId === 'string' ? entry.workId : undefined;
  const kind = entry.kind;
  const parts: string[] = [];
  if (kind === 'directory') parts.push('目录');
  else if (kind === 'file') parts.push('文件');
  if (typeof entry.type === 'string' && entry.type) parts.push(entry.type);
  if (kind === 'document' && typeof entry.wordCount === 'number') parts.push(wordsText(entry.wordCount));
  if (entry.pending === true) parts.push('待审');
  return {
    key: entryId || String(index),
    ...(kind === 'document' && entryId
      ? { target: entryTarget({ workId, entryId, title }) }
      : { label: kind === 'directory' ? `${title}/` : title }),
    ...(parts.length && { meta: parts.join(' · ') })
  };
}

/** work_read：文稿或资料正文，图片资料只有说明。 */
export function readDetail({ tool, value }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const doc = asRecord(value);
  if (doc && doc.type === 'image') {
    meta.push('图片资料');
    if (typeof doc.mimeType === 'string') meta.push(doc.mimeType);
    return { meta, ...(typeof doc.note === 'string' && doc.note && { body: doc.note }) };
  }
  if (doc) {
    const sec = sectionLabel(doc.section ?? tool.info?.section);
    if (sec) meta.push(sec);
    appendAttributesMeta(meta, doc.attributes);
    if (typeof doc.wordCount === 'number') meta.push(wordsText(doc.wordCount));
    const status = writeStatusLabel(undefined, doc.pending);
    if (status) meta.push(status);
    return { meta, ...(typeof doc.content === 'string' && { body: doc.content }) };
  }
  const sec = sectionLabel(tool.info?.section);
  if (sec) meta.push(sec);
  if (typeof tool.info?.wordCount === 'number') meta.push(wordsText(tool.info.wordCount));
  const fallbackText = typeof value === 'string' ? value : tool.result?.text || undefined;
  return { meta, ...(fallbackText && { body: fallbackText }) };
}

/** work_write：写入的正文与属性。 */
export function writeDetail({ tool, input, value, structured }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const saved = asRecord(value);
  const entry = asRecord(saved?.entry);
  const sec = sectionLabel(entry?.section ?? input?.section ?? tool.info?.section);
  if (sec) meta.push(sec);
  const status = writeStatusLabel(saved?.kind);
  if (status) meta.push(status);
  appendAttributesMeta(meta, input?.attributes);
  const words = typeof entry?.wordCount === 'number' ? entry.wordCount : tool.info?.wordCount;
  if (typeof words === 'number') meta.push(wordsText(words));
  const body =
    typeof input?.content === 'string'
      ? input.content
      : !structured && tool.result?.text
        ? tool.result.text
        : undefined;
  return { meta, ...(body && { body }) };
}

/** work_edit：逐处替换。 */
export function editDetail({ tool, input, value }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const saved = asRecord(value);
  const entry = asRecord(saved?.entry);
  const sec = sectionLabel(entry?.section ?? tool.info?.section);
  if (sec) meta.push(sec);
  const status = writeStatusLabel(saved?.kind);
  if (status) meta.push(status);
  const words = typeof entry?.wordCount === 'number' ? entry.wordCount : tool.info?.wordCount;
  if (typeof words === 'number') meta.push(wordsText(words));
  const edits = extractEdits(input);
  return { meta, ...(edits && { edits }) };
}

/** work_ls、work_find、work_search：条目或作品列表。 */
export function entryListDetail({ tool, value }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const searchObj = tool.name === 'work_search' ? asRecord(value) : undefined;
  const list = Array.isArray(value) ? value : Array.isArray(searchObj?.entries) ? searchObj.entries : undefined;
  if (searchObj?.hasMore === true) meta.push('还有更多结果');
  if (!list) return { meta };
  const items = asRecords(list).map((item, idx): ToolDetailItem => {
    if (!('entryId' in item) && !('section' in item) && typeof item.workId === 'string') {
      return {
        key: item.workId,
        label: `《${typeof item.title === 'string' ? item.title : '未命名作品'}》`,
        meta: item.kind === 'script' ? '剧本' : '小说'
      };
    }
    return mapEntryItem(item, idx);
  });
  return listContent(meta, items, tool.name === 'work_ls' ? '目录为空' : '无匹配条目');
}

/** work_grep：命中的行。 */
export function grepDetail({ value }: WorkToolCall): ToolDetailContent {
  if (!Array.isArray(value)) return { meta: [] };
  const items = asRecords(value).map((hit, idx): ToolDetailItem => {
    const entryId = typeof hit.entryId === 'string' ? hit.entryId : '';
    const title = typeof hit.title === 'string' ? hit.title : '文稿';
    const workId = typeof hit.workId === 'string' ? hit.workId : undefined;
    return {
      key: `${entryId}:${String(hit.line ?? idx)}:${idx}`,
      ...(entryId ? { target: entryTarget({ workId, entryId, title }) } : { label: `《${title}》` }),
      ...(typeof hit.line === 'number' && { meta: `第 ${hit.line} 行` }),
      ...(typeof hit.text === 'string' && { snippet: hit.text })
    };
  });
  return listContent([], items, '无匹配内容');
}

/** work_mkdir、work_mv、work_rm：目录变更。 */
export function entryChangeDetail({ tool, input, value }: WorkToolCall): ToolDetailContent {
  const meta: string[] = [];
  const res = asRecord(value);
  if (res?.kind === 'trashed' && Array.isArray(res.entries)) {
    meta.push('已移入回收站');
    const items = asRecords(res.entries).map((item, idx) => ({
      key: String(item.entryId ?? idx),
      label: typeof item.title === 'string' ? `《${item.title}》` : '条目'
    }));
    return { meta, items };
  }
  const entry = asRecord(res?.entry);
  const sec = sectionLabel(entry?.section ?? input?.section ?? tool.info?.section);
  if (sec) meta.push(sec);
  const status = writeStatusLabel(res?.kind);
  if (status) meta.push(status);
  return { meta };
}
