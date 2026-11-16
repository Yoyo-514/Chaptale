import type { ToolActivity, ToolEntryTarget } from './transcript';

export interface ResolvedEntryInfo {
  workId?: string;
  entryId: string;
  title: string;
  kind: 'directory' | 'document' | 'file';
}

export type EntryLookup = (entryId: string) => ResolvedEntryInfo | undefined;

export interface ToolDetailItem {
  key: string;
  target?: ToolEntryTarget;
  connector?: string;
  secondaryTarget?: ToolEntryTarget;
  label?: string;
  meta?: string;
  snippet?: string;
}

export interface ToolDetailEdit {
  oldText: string;
  newText: string;
}

export interface ParsedToolDetail {
  meta: string[];
  error?: string;
  items?: ToolDetailItem[];
  emptyText?: string;
  edits?: ToolDetailEdit[];
  basis?: string;
  body?: string;
  hasRaw: boolean;
  rawInput?: string;
  rawOutput?: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function sectionLabel(section: unknown): string | undefined {
  return section === 'resource' ? '资料' : section === 'manuscript' ? '文稿' : undefined;
}

function writeStatusLabel(kind: unknown, pending?: unknown): string | undefined {
  if (kind === 'pending' || pending === true) return '待接受修改';
  if (kind === 'removed') return '已移除';
  if (kind === 'saved') return '已保存';
  return undefined;
}

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

function formatPlacement(placement: unknown, lookup?: EntryLookup): string | undefined {
  if (placement === 'opening') return '开篇之前';
  if (placement === 'undetermined') return '位置待定';
  if (typeof placement === 'string' && placement) {
    const entry = lookup?.(placement);
    return entry ? `发生于《${entry.title}》` : undefined;
  }
  const obj = asRecord(placement);
  if (!obj) return undefined;
  if (obj.kind === 'opening') return '开篇之前';
  if (obj.kind === 'undetermined') return '位置待定';
  if (obj.kind === 'chapter' && typeof obj.chapterId === 'string') {
    const entry = lookup?.(obj.chapterId);
    return entry ? `发生于《${entry.title}》` : undefined;
  }
  return undefined;
}

function formatRawOutput(text: string | undefined): {
  parsedOk?: boolean;
  value?: unknown;
  errorMsg?: string;
  pretty?: string;
} {
  if (!text) return {};
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const pretty = JSON.stringify(parsed, null, 2);
      const rec = asRecord(parsed);
      if (rec && typeof rec.ok === 'boolean') {
        if (rec.ok) return { parsedOk: true, value: rec.value, pretty };
        const err = asRecord(rec.error);
        return {
          parsedOk: false,
          errorMsg: typeof err?.message === 'string' ? err.message : text,
          pretty
        };
      }
      return { pretty };
    } catch {
      return { pretty: text };
    }
  }
  return { pretty: text };
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
  if (kind === 'document' && typeof entry.wordCount === 'number') {
    parts.push(`${entry.wordCount.toLocaleString('en-US')} 字`);
  }
  if (entry.pending === true) parts.push('待审');
  return {
    key: entryId || String(index),
    ...(kind === 'document' && entryId
      ? { target: { ...(workId && { workId }), entryId, title } }
      : { label: kind === 'directory' ? `${title}/` : title }),
    ...(parts.length && { meta: parts.join(' · ') })
  };
}

function extractEdits(input: JsonRecord | undefined): ToolDetailEdit[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input.edits)) {
    const list = input.edits
      .map(item => asRecord(item))
      .filter((item): item is JsonRecord => Boolean(item))
      .filter(item => typeof item.oldText === 'string' && typeof item.newText === 'string')
      .map(item => ({ oldText: item.oldText as string, newText: item.newText as string }));
    return list.length ? list : undefined;
  }
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    return [{ oldText: input.oldText, newText: input.newText }];
  }
  return undefined;
}

const codemodeHeaderPattern =
  /^Script completed in (\d+(?:\.\d+)?)ms(?:\.| with no output\.)(?:\s*Output:\s*\n\n([\s\S]*))?$/;

/** 把工具参数与返回文本解析为创作者可读的结构化摘要，原始 JSON 单独归档供按需展开。 */
export function parseToolDetail(tool: ToolActivity, lookup?: EntryLookup): ParsedToolDetail {
  const input = asRecord(tool.input);
  const rawInput =
    tool.input !== undefined && (!input || Object.keys(input).length > 0)
      ? JSON.stringify(tool.input, null, 2)
      : undefined;
  const { parsedOk, value, errorMsg, pretty: rawOutput } = formatRawOutput(tool.result?.text);
  const hasRaw = Boolean(rawInput || rawOutput);
  const meta: string[] = [];

  if (tool.result?.error || parsedOk === false) {
    const error = errorMsg ?? tool.info?.error ?? (tool.result?.text || '调用未成功');
    const edits = extractEdits(input);
    return { meta, error, ...(edits && { edits }), hasRaw, rawInput, rawOutput };
  }

  if (tool.name === 'codemode') {
    const text = tool.result?.text ?? '';
    const matched = codemodeHeaderPattern.exec(text);
    if (matched) {
      meta.push(`耗时 ${matched[1]} ms`);
      const output = matched[2]?.trimEnd();
      return {
        meta,
        ...(output ? { body: output } : { emptyText: '脚本已完成，无返回文本' }),
        hasRaw,
        rawInput,
        rawOutput
      };
    }
    return {
      meta,
      ...(text ? { body: text } : {}),
      hasRaw,
      rawInput,
      rawOutput
    };
  }

  // 非 CreationResult JSON（例如原生 read / ls / find / grep / tool_search 或纯文本回执）
  if (parsedOk === undefined && !tool.name.startsWith('work_')) {
    const edits = extractEdits(input);
    const body = tool.result?.text || undefined;
    return { meta, ...(edits && { edits }), ...(body && { body }), hasRaw, rawInput, rawOutput };
  }

  switch (tool.name) {
    case 'work_read': {
      const doc = asRecord(value);
      if (doc && doc.type === 'image') {
        meta.push('图片资料');
        if (typeof doc.mimeType === 'string') meta.push(doc.mimeType);
        return {
          meta,
          ...(typeof doc.note === 'string' && doc.note && { body: doc.note }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      if (doc) {
        const sec = sectionLabel(doc.section ?? tool.info?.section);
        if (sec) meta.push(sec);
        appendAttributesMeta(meta, doc.attributes);
        if (typeof doc.wordCount === 'number') meta.push(`${doc.wordCount.toLocaleString('en-US')} 字`);
        const status = writeStatusLabel(undefined, doc.pending);
        if (status) meta.push(status);
        return {
          meta,
          ...(typeof doc.content === 'string' && { body: doc.content }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      const sec = sectionLabel(tool.info?.section);
      if (sec) meta.push(sec);
      if (typeof tool.info?.wordCount === 'number') meta.push(`${tool.info.wordCount.toLocaleString('en-US')} 字`);
      const fallbackText = typeof value === 'string' ? value : tool.result?.text || undefined;
      return { meta, ...(fallbackText && { body: fallbackText }), hasRaw, rawInput, rawOutput };
    }

    case 'work_write': {
      const saved = asRecord(value);
      const entry = asRecord(saved?.entry);
      const sec = sectionLabel(entry?.section ?? input?.section ?? tool.info?.section);
      if (sec) meta.push(sec);
      const status = writeStatusLabel(saved?.kind);
      if (status) meta.push(status);
      appendAttributesMeta(meta, input?.attributes);
      const words = typeof entry?.wordCount === 'number' ? entry.wordCount : tool.info?.wordCount;
      if (typeof words === 'number') meta.push(`${words.toLocaleString('en-US')} 字`);
      const body =
        typeof input?.content === 'string'
          ? input.content
          : parsedOk === undefined && tool.result?.text
            ? tool.result.text
            : undefined;
      return { meta, ...(body && { body }), hasRaw, rawInput, rawOutput };
    }

    case 'work_edit': {
      const saved = asRecord(value);
      const entry = asRecord(saved?.entry);
      const sec = sectionLabel(entry?.section ?? tool.info?.section);
      if (sec) meta.push(sec);
      const status = writeStatusLabel(saved?.kind);
      if (status) meta.push(status);
      const words = typeof entry?.wordCount === 'number' ? entry.wordCount : tool.info?.wordCount;
      if (typeof words === 'number') meta.push(`${words.toLocaleString('en-US')} 字`);
      const edits = extractEdits(input);
      return { meta, ...(edits && { edits }), hasRaw, rawInput, rawOutput };
    }

    case 'work_ls':
    case 'work_find':
    case 'work_search': {
      const searchObj = tool.name === 'work_search' ? asRecord(value) : undefined;
      const list = Array.isArray(value) ? value : Array.isArray(searchObj?.entries) ? searchObj.entries : undefined;
      if (searchObj?.hasMore === true) meta.push('还有更多结果');
      if (list) {
        const items = list
          .map(item => asRecord(item))
          .filter((item): item is JsonRecord => Boolean(item))
          .map((item, idx): ToolDetailItem => {
            if (!('entryId' in item) && !('section' in item) && typeof item.workId === 'string') {
              return {
                key: item.workId,
                label: `《${typeof item.title === 'string' ? item.title : '未命名作品'}》`,
                meta: item.kind === 'script' ? '剧本' : '小说'
              };
            }
            return mapEntryItem(item, idx);
          });
        return {
          meta,
          items,
          ...(items.length === 0 && { emptyText: tool.name === 'work_ls' ? '目录为空' : '无匹配条目' }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      return { meta, hasRaw, rawInput, rawOutput };
    }

    case 'work_grep': {
      if (Array.isArray(value)) {
        const items = value
          .map(item => asRecord(item))
          .filter((item): item is JsonRecord => Boolean(item))
          .map((hit, idx): ToolDetailItem => {
            const entryId = typeof hit.entryId === 'string' ? hit.entryId : '';
            const title = typeof hit.title === 'string' ? hit.title : '文稿';
            const workId = typeof hit.workId === 'string' ? hit.workId : undefined;
            return {
              key: `${entryId}:${String(hit.line ?? idx)}:${idx}`,
              ...(entryId ? { target: { ...(workId && { workId }), entryId, title } } : { label: `《${title}》` }),
              ...(typeof hit.line === 'number' && { meta: `第 ${hit.line} 行` }),
              ...(typeof hit.text === 'string' && { snippet: hit.text })
            };
          });
        return {
          meta,
          items,
          ...(items.length === 0 && { emptyText: '无匹配内容' }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      return { meta, hasRaw, rawInput, rawOutput };
    }

    case 'work_mkdir':
    case 'work_mv':
    case 'work_rm': {
      const res = asRecord(value);
      if (res?.kind === 'trashed' && Array.isArray(res.entries)) {
        meta.push('已移入回收站');
        const items = res.entries
          .map(item => asRecord(item))
          .filter((item): item is JsonRecord => Boolean(item))
          .map((item, idx) => ({
            key: String(item.entryId ?? idx),
            label: typeof item.title === 'string' ? `《${item.title}》` : '条目'
          }));
        return { meta, items, hasRaw, rawInput, rawOutput };
      }
      const entry = asRecord(res?.entry);
      const sec = sectionLabel(entry?.section ?? input?.section ?? tool.info?.section);
      if (sec) meta.push(sec);
      const status = writeStatusLabel(res?.kind);
      if (status) meta.push(status);
      return { meta, hasRaw, rawInput, rawOutput };
    }

    case 'work_record_ls': {
      if (Array.isArray(value)) {
        const items = value
          .map(item => asRecord(item))
          .filter((item): item is JsonRecord => Boolean(item))
          .map((rec, idx): ToolDetailItem => {
            const parts: string[] = [];
            if (Array.isArray(rec.resourceIds) && lookup) {
              const names = rec.resourceIds
                .map(rid => (typeof rid === 'string' ? lookup(rid)?.title : undefined))
                .filter((name): name is string => Boolean(name));
              if (names.length) parts.push(names.join('、'));
            }
            const place = formatPlacement(rec.placement, lookup);
            if (place) parts.push(place);
            if (typeof rec.storyTime === 'string' && rec.storyTime) parts.push(rec.storyTime);
            if (rec.pending === true) parts.push('待审');
            if (rec.sourceChanged === true) parts.push('出处已更新');
            return {
              key: typeof rec.recordId === 'string' ? rec.recordId : String(idx),
              label: typeof rec.text === 'string' ? rec.text : '',
              ...(parts.length && { meta: parts.join(' · ') })
            };
          });
        return {
          meta,
          items,
          ...(items.length === 0 && { emptyText: '暂无事件记录' }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      return { meta, hasRaw, rawInput, rawOutput };
    }

    case 'work_record_write': {
      const res = asRecord(value);
      const rec = asRecord(res?.record);
      const status = writeStatusLabel(res?.kind, rec?.pending);
      if (status) meta.push(status);
      const resourceIds = Array.isArray(rec?.resourceIds)
        ? rec.resourceIds
        : Array.isArray(input?.resourceIds)
          ? input.resourceIds
          : [];
      if (resourceIds.length && lookup) {
        const names = resourceIds
          .map(rid => (typeof rid === 'string' ? lookup(rid)?.title : undefined))
          .filter((name): name is string => Boolean(name));
        if (names.length) meta.push(`涉及：${names.join('、')}`);
      }
      const place = formatPlacement(rec?.placement ?? input?.placement, lookup);
      if (place) meta.push(place);
      const storyTime = typeof rec?.storyTime === 'string' ? rec.storyTime : input?.storyTime;
      if (typeof storyTime === 'string' && storyTime) meta.push(storyTime);
      const body = typeof rec?.text === 'string' ? rec.text : typeof input?.text === 'string' ? input.text : undefined;
      const basis = typeof input?.basis === 'string' && input.basis ? input.basis : undefined;
      return { meta, ...(body && { body }), ...(basis && { basis }), hasRaw, rawInput, rawOutput };
    }

    case 'work_relation_ls': {
      const res = asRecord(value);
      if (Array.isArray(res?.relations)) {
        const items = res.relations
          .map(item => asRecord(item))
          .filter((item): item is JsonRecord => Boolean(item))
          .map((rel, idx): ToolDetailItem => {
            const ids = Array.isArray(rel.resourceIds) ? rel.resourceIds : [];
            const left = typeof ids[0] === 'string' && lookup ? lookup(ids[0]) : undefined;
            const right = typeof ids[1] === 'string' && lookup ? lookup(ids[1]) : undefined;
            const connector = rel.directed === false ? '↔' : '→';
            const typeText = typeof rel.type === 'string' ? rel.type : '关系';
            const titles = Array.isArray(rel.titles) ? rel.titles : [];
            const rolePair =
              typeof titles[0] === 'string' && typeof titles[1] === 'string' && titles[0] !== titles[1]
                ? `（${titles[0]} / ${titles[1]}）`
                : '';
            const parts = [`${typeText}${rolePair}`];
            if (rel.state === 'active') parts.push('持续中');
            else if (rel.state === 'ended') parts.push('已结束');
            if (rel.pending === true) parts.push('待审');
            if (left?.kind === 'document' && right?.kind === 'document') {
              return {
                key: typeof rel.relationId === 'string' ? rel.relationId : String(idx),
                target: { ...(left.workId && { workId: left.workId }), entryId: left.entryId, title: left.title },
                connector,
                secondaryTarget: {
                  ...(right.workId && { workId: right.workId }),
                  entryId: right.entryId,
                  title: right.title
                },
                meta: parts.join(' · ')
              };
            }
            const fallbackLabel =
              left || right ? `《${left?.title ?? '资料'}》 ${connector} 《${right?.title ?? '资料'}》` : typeText;
            return {
              key: typeof rel.relationId === 'string' ? rel.relationId : String(idx),
              label: fallbackLabel,
              meta: parts.join(' · ')
            };
          });
        return {
          meta,
          items,
          ...(items.length === 0 && { emptyText: '暂无关系记录' }),
          hasRaw,
          rawInput,
          rawOutput
        };
      }
      return { meta, hasRaw, rawInput, rawOutput };
    }

    case 'work_relation_write': {
      const res = asRecord(value);
      const rel = asRecord(res?.relation);
      const status = writeStatusLabel(res?.kind, rel?.pending);
      if (status) meta.push(status);
      const relType = typeof rel?.type === 'string' ? rel.type : typeof input?.type === 'string' ? input.type : '';
      const titles = Array.isArray(rel?.titles) ? rel.titles : Array.isArray(input?.titles) ? input.titles : [];
      const rolePair =
        typeof titles[0] === 'string' && typeof titles[1] === 'string' && titles[0] !== titles[1]
          ? `（${titles[0]} / ${titles[1]}）`
          : '';
      if (relType) meta.push(`${relType}${rolePair}`);
      const ids = Array.isArray(rel?.resourceIds)
        ? rel.resourceIds
        : Array.isArray(input?.resourceIds)
          ? input.resourceIds
          : [];
      const left = typeof ids[0] === 'string' && lookup ? lookup(ids[0]) : undefined;
      const right = typeof ids[1] === 'string' && lookup ? lookup(ids[1]) : undefined;
      const connector = (rel?.directed ?? input?.directed) === false ? '↔' : '→';
      const items: ToolDetailItem[] | undefined =
        left?.kind === 'document' && right?.kind === 'document'
          ? [
              {
                key: 'pair',
                target: { ...(left.workId && { workId: left.workId }), entryId: left.entryId, title: left.title },
                connector,
                secondaryTarget: {
                  ...(right.workId && { workId: right.workId }),
                  entryId: right.entryId,
                  title: right.title
                }
              }
            ]
          : undefined;
      const basis = typeof input?.basis === 'string' && input.basis ? input.basis : undefined;
      return { meta, ...(items && { items }), ...(basis && { basis }), hasRaw, rawInput, rawOutput };
    }

    default:
      return { meta, hasRaw, rawInput, rawOutput };
  }
}
