import type { ToolActivity, ToolEntryTarget } from '../transcript';

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

export type JsonRecord = Record<string, unknown>;

/** 一次作品工具调用里各解析函数共用的输入。 */
export interface WorkToolCall {
  tool: ToolActivity;
  input: JsonRecord | undefined;
  /** 返回文本是成功的 CreationResult 时取其 value。 */
  value: unknown;
  /** 返回文本是 CreationResult JSON；纯文本回执为 false。 */
  structured: boolean;
  lookup?: EntryLookup;
}

/** 各工具只给出展示内容，原始输入输出由入口统一附加。 */
export type ToolDetailContent = Pick<ParsedToolDetail, 'meta' | 'items' | 'emptyText' | 'edits' | 'basis' | 'body'>;
