import type { CreationApplication } from '@chaptale/creation/application';
import type { Entry } from '@chaptale/creation/contracts';

import type { EditMode, ToolResultInfo } from '../protocol/index.ts';

/** 运行中的子调用摘要只取定位字段；整章正文和脚本代码沿用 SDK 最终记录。 */
export function previewToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const fields = new Set([
    'workId',
    'title',
    'section',
    'entryId',
    'recordId',
    'relationId',
    'remove',
    'pattern',
    'query',
    'path',
    'file_path',
    'text'
  ]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => fields.has(key)));
}

export type ToolTargetLookup = (input: unknown, toolName?: string) => ToolResultInfo | undefined;

export function composeToolTargetLookup(...lookups: Array<ToolTargetLookup | undefined>): ToolTargetLookup | undefined {
  const active = lookups.filter((fn): fn is ToolTargetLookup => Boolean(fn));
  if (active.length === 0) return undefined;
  return (input, toolName) => {
    for (const lookup of active) {
      const info = lookup(input, toolName);
      if (info) return info;
    }
    return undefined;
  };
}

/** 一次投影内每部作品只读一份目录，把原生参数中的条目 ID 显示为可读标题。 */
export function toolTargetLookup(creation: CreationApplication, sessionId: string, mode: EditMode): ToolTargetLookup {
  const works = new Map<string, Entry[]>();
  return input => {
    const fields = object(input);
    if (typeof fields?.workId !== 'string' || typeof fields.entryId !== 'string') return undefined;
    let entries = works.get(fields.workId);
    if (!entries) {
      const result = creation.executeAgent(
        { sessionId, mode },
        { method: 'listEntries', input: { workId: fields.workId } }
      );
      if (!result.ok) return undefined;
      entries = result.value;
      works.set(fields.workId, entries);
    }
    const entry = entries.find(item => item.id === fields.entryId);
    return entry && { workId: fields.workId, entryId: entry.id, title: entry.title, section: entry.section };
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 从 SDK 原生 toolResult.details 提取可读标题、字数与计数摘要。 */
export function toolResultInfo(details: unknown): ToolResultInfo | undefined {
  const result = object(details);
  if (!result) return undefined;
  // pi 的 MCP 工具结果自带服务名与工具名；服务被移除后，历史记录仍能显示调用对象。
  if (typeof result.server === 'string' && typeof result.tool === 'string') {
    return { ...(result.server && { mcpServer: result.server }), mcpTool: result.tool };
  }
  if (!('ok' in result)) return undefined;
  if (result.ok === false) {
    const error = object(result.error);
    return typeof error?.message === 'string' ? { error: error.message } : undefined;
  }
  const value = object(result.value);
  if (!value) return Array.isArray(result.value) ? { count: result.value.length } : undefined;
  const entry = object(value.entry) ?? value;
  const record = object(value.record);
  const relation = object(value.relation);
  const entries = value.entries ?? value.relations ?? value.hits;
  return {
    ...(typeof entry.workId === 'string' && { workId: entry.workId }),
    ...(typeof entry.entryId === 'string' && { entryId: entry.entryId }),
    ...(typeof entry.id === 'string' &&
      (entry.section === 'manuscript' || entry.section === 'resource') && { entryId: entry.id }),
    ...(typeof entry.title === 'string' && { title: entry.title }),
    ...((entry.section === 'manuscript' || entry.section === 'resource') && { section: entry.section }),
    ...(typeof entry.wordCount === 'number' && { wordCount: entry.wordCount }),
    ...(Array.isArray(entries) && { count: entries.length }),
    ...(typeof record?.text === 'string' && { description: record.text }),
    ...(typeof relation?.type === 'string' && { description: relation.type })
  };
}

/** 从嵌套子调用持久化错误文本中提取可读消息，避免界面直接展示 CreationResult 的原始 JSON。 */
export function nestedToolError(error: string | undefined): string | undefined {
  if (!error?.startsWith('{')) return error;
  try {
    return toolResultInfo(JSON.parse(error))?.error ?? error;
  } catch {
    return error;
  }
}
