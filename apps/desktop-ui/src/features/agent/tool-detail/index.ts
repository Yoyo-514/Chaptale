import type { ToolActivity } from '../transcript';
import { editDetail, entryChangeDetail, entryListDetail, grepDetail, readDetail, writeDetail } from './entries';
import { asRecord, extractEdits } from './shared';
import { recordListDetail, recordWriteDetail, relationListDetail, relationWriteDetail } from './story';
import type { EntryLookup, ParsedToolDetail, ToolDetailContent, WorkToolCall } from './types';

export type { EntryLookup, ParsedToolDetail, ResolvedEntryInfo, ToolDetailEdit, ToolDetailItem } from './types';

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

const codemodeHeaderPattern =
  /^Script completed in (\d+(?:\.\d+)?)ms(?:\.| with no output\.)(?:\s*Output:\s*\n\n([\s\S]*))?$/;

/** codemode：脚本耗时与输出。 */
function codemodeDetail(text: string): ToolDetailContent {
  const matched = codemodeHeaderPattern.exec(text);
  if (!matched) return { meta: [], ...(text ? { body: text } : {}) };
  const output = matched[2]?.trimEnd();
  return { meta: [`耗时 ${matched[1]} ms`], ...(output ? { body: output } : { emptyText: '脚本已完成，无返回文本' }) };
}

const workTools = new Map<string, (call: WorkToolCall) => ToolDetailContent>([
  ['work_read', readDetail],
  ['work_write', writeDetail],
  ['work_edit', editDetail],
  ['work_ls', entryListDetail],
  ['work_find', entryListDetail],
  ['work_search', entryListDetail],
  ['work_grep', grepDetail],
  ['work_mkdir', entryChangeDetail],
  ['work_mv', entryChangeDetail],
  ['work_rm', entryChangeDetail],
  ['work_record_ls', recordListDetail],
  ['work_record_write', recordWriteDetail],
  ['work_relation_ls', relationListDetail],
  ['work_relation_write', relationWriteDetail]
]);

/** 把工具参数与返回文本解析为创作者可读的结构化摘要，原始 JSON 单独归档供按需展开。 */
export function parseToolDetail(tool: ToolActivity, lookup?: EntryLookup): ParsedToolDetail {
  const input = asRecord(tool.input);
  const rawInput =
    tool.input !== undefined && (!input || Object.keys(input).length > 0)
      ? JSON.stringify(tool.input, null, 2)
      : undefined;
  const { parsedOk, value, errorMsg, pretty: rawOutput } = formatRawOutput(tool.result?.text);
  const raw = { hasRaw: Boolean(rawInput || rawOutput), rawInput, rawOutput };

  if (tool.result?.error || parsedOk === false) {
    const error = errorMsg ?? tool.info?.error ?? (tool.result?.text || '调用未成功');
    const edits = extractEdits(input);
    return { meta: [], error, ...(edits && { edits }), ...raw };
  }

  if (tool.name === 'codemode') return { ...codemodeDetail(tool.result?.text ?? ''), ...raw };

  // 非 CreationResult JSON（例如原生 read / ls / find / grep / tool_search 或纯文本回执）
  if (parsedOk === undefined && !tool.name.startsWith('work_')) {
    const edits = extractEdits(input);
    const body = tool.result?.text || undefined;
    return { meta: [], ...(edits && { edits }), ...(body && { body }), ...raw };
  }

  const content = workTools.get(tool.name)?.({ tool, input, value, structured: parsedOk === true, lookup });
  return { ...(content ?? { meta: [] }), ...raw };
}
