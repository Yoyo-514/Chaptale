import type { JsonValue } from '@earendil-works/pi-ai';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { posix } from 'node:path';
import { Type, type TSchema } from 'typebox';

import type { CreationApplication } from '@chaptale/creation/application';
import type { AgentWriteResult, CreationAgentContext, CreationResult, Entry } from '@chaptale/creation/contracts';

import type { EditMode } from '../protocol.ts';

const id = Type.String({ minLength: 1 });
const nullableId = Type.Union([id, Type.Null()]);
const target = { workId: id, entryId: id };
const revisionTarget = { ...target, expectedRevisionId: id };
const section = Type.Union([Type.Literal('manuscript'), Type.Literal('resource')]);
const newEntry = { workId: id, parentId: nullableId, title: Type.String(), section };
// OpenAI 兼容接口要求工具参数顶层为 type: object，不能用 Union；分支字段设为可选，组合由 creation 的参数校验判定。
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });

export const workWriteToolNames = new Set(['work_edit', 'work_write', 'work_mkdir', 'work_mv', 'work_rm']);
export const workToolNames = new Set([
  'work_ls',
  'work_read',
  'work_find',
  'work_grep',
  'work_search',
  ...workWriteToolNames
]);

function located<T extends Entry>(workId: string, entry: T) {
  const { id: entryId, ...metadata } = entry;
  return { workId, entryId, ...metadata };
}

function mapResult<T, U>(result: CreationResult<T>, map: (value: T) => U): CreationResult<U> {
  return result.ok ? { ok: true, value: map(result.value) } : result;
}

/** 作品工具只转换公共参数；身份、内容与候选规则由宿主和 creation 持有。 */
export function createWorkTools(
  application: CreationApplication,
  mode: (sessionId: string) => EditMode,
  onPendingWrite: (sessionId: string) => void
): ToolDefinition[] {
  function written(context: CreationAgentContext, workId: string, result: CreationResult<AgentWriteResult>) {
    if (result.ok && result.value.kind === 'pending') onPendingWrite(context.sessionId);
    return mapResult(result, (value): JsonValue => {
      if (value.kind === 'trashed')
        return { kind: value.kind, entries: value.entries.map(entry => located(workId, entry)) };
      return {
        kind: value.kind,
        entry: located(workId, value.kind === 'saved' ? value.entry : value.change.candidate)
      };
    });
  }

  function tool<S extends TSchema>(
    name: string,
    label: string,
    description: string,
    parameters: S,
    execute: (
      input: Parameters<ToolDefinition<S>['execute']>[1],
      context: CreationAgentContext,
      commandId: string
    ) => CreationResult<JsonValue>
  ): ToolDefinition {
    return defineTool({
      name,
      label,
      description,
      parameters,
      async execute(toolCallId, input, signal, _onUpdate, ctx) {
        signal?.throwIfAborted();
        const sessionId = ctx.sessionManager.getSessionId();
        const result = execute(input, { sessionId, mode: mode(sessionId) }, JSON.stringify([sessionId, toolCallId]));
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
          structuredContent: result,
          isError: !result.ok
        };
      }
    });
  }

  return [
    tool(
      'work_ls',
      '浏览作品',
      'workId 为 null 时列出作品；提供作品 ID 时列出 entryId 目录的直接子条目，entryId 缺省或为 null 表示根目录。返回稳定 ID 与修订、位置元数据。',
      object({ workId: nullableId, entryId: Type.Optional(nullableId), section: Type.Optional(section) }),
      (input, context) => {
        if (input.workId === null)
          return mapResult(application.executeAgent(context, { method: 'listWorks', input: {} }), works =>
            works.map(({ id: workId, ...work }) => ({ workId, ...work }))
          );
        const workId = input.workId;
        const result = application.executeAgent(context, { method: 'listEntries', input: { workId } });
        if (!result.ok) return result;
        const parentId = input.entryId ?? null;
        if (parentId !== null && !result.value.some(entry => entry.id === parentId && entry.kind === 'directory'))
          return { ok: false, error: { code: 'failed', message: '作品目录不存在' } };
        return {
          ok: true,
          value: result.value
            .filter(entry => entry.parentId === parentId && (!input.section || entry.section === input.section))
            .map(entry => located(workId, entry))
        };
      }
    ),
    tool(
      'work_read',
      '读取作品正文',
      '按 workId 与 entryId 读取文稿或资料，包含本会话待接受修改；资料另附类型、别名与标签。offset 为从 1 开始的行号，省略时从首行读取；limit 为最多读取行数，省略时读取至末尾。',
      object({
        ...target,
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1 }))
      }),
      (input, context) =>
        mapResult(
          application.executeAgent(context, {
            method: 'readDocument',
            input: { workId: input.workId, documentId: input.entryId }
          }),
          ({ attributes, ...document }) => {
            const start = (input.offset ?? 1) - 1;
            const content = document.content
              .split('\n')
              .slice(start, input.limit === undefined ? undefined : start + input.limit)
              .join('\n');
            return {
              ...located(input.workId, document),
              content,
              ...(attributes && {
                attributes: { type: attributes.type, aliases: [...attributes.aliases], tags: [...attributes.tags] }
              })
            };
          }
        )
    ),
    tool(
      'work_find',
      '查找作品条目',
      '在指定作品内按 glob 通配符匹配条目名称，包含本会话候选名称，返回稳定 ID、修订与位置。section 可限定文稿或资料分区。',
      object({ workId: id, pattern: Type.String(), section: Type.Optional(section) }),
      (input, context) =>
        mapResult(
          application.executeAgent(context, { method: 'listEntries', input: { workId: input.workId } }),
          entries =>
            entries
              .filter(
                entry =>
                  (!input.section || entry.section === input.section) && posix.matchesGlob(entry.title, input.pattern)
              )
              .map(entry => located(input.workId, entry))
        )
    ),
    tool(
      'work_grep',
      '查找作品正文',
      '按 JavaScript 正则表达式逐行查找指定作品正文，包含本会话候选。返回稳定 ID、修订、从 1 开始的行号及匹配行；section 可限定分区。',
      object({ workId: id, pattern: Type.String(), section: Type.Optional(section) }),
      (input, context) => {
        let pattern: RegExp;
        try {
          pattern = new RegExp(input.pattern);
        } catch {
          return { ok: false, error: { code: 'invalid-request', message: '正则表达式无效' } };
        }
        const entries = application.executeAgent(context, { method: 'listEntries', input: { workId: input.workId } });
        if (!entries.ok) return entries;
        const matches = [];
        for (const entry of entries.value) {
          if (entry.kind !== 'document' || (input.section && entry.section !== input.section)) continue;
          const result = application.executeAgent(context, {
            method: 'readDocument',
            input: { workId: input.workId, documentId: entry.id }
          });
          if (!result.ok) return result;
          const lines = result.value.content.split('\n');
          for (const [index, text] of lines.entries()) {
            if (pattern.test(text))
              matches.push({
                workId: input.workId,
                entryId: entry.id,
                revisionId: result.value.revisionId,
                title: entry.title,
                line: index + 1,
                text
              });
          }
        }
        return { ok: true, value: matches };
      }
    ),
    tool(
      'work_search',
      '中文全文检索',
      '使用 FTS5 中文全文检索指定作品，包含本会话候选。offset 从 0 开始，limit 为每页条目数；返回稳定 ID、修订及 hasMore，正文通过 work_read 获取。',
      object({
        workId: id,
        query: Type.String({ minLength: 1, pattern: '\\S' }),
        offset: Type.Integer({ minimum: 0 }),
        limit: Type.Integer({ minimum: 1 }),
        section: Type.Optional(section)
      }),
      (input, context) =>
        mapResult(application.executeAgent(context, { method: 'searchDocuments', input }), page => ({
          entries: page.entries.map(entry => located(input.workId, entry)),
          hasMore: page.hasMore
        }))
    ),
    tool(
      'work_edit',
      '精确编辑作品正文',
      '按读取所得修订替换唯一匹配的 oldText。审阅模式写入本会话候选，直接修改模式生成正式修订。',
      object({ ...revisionTarget, oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
      (input, context, commandId) =>
        written(
          context,
          input.workId,
          application.executeAgent(context, {
            method: 'editDocument',
            input: {
              commandId,
              workId: input.workId,
              documentId: input.entryId,
              expectedRevisionId: input.expectedRevisionId,
              oldText: input.oldText,
              newText: input.newText
            }
          })
        )
    ),
    tool(
      'work_write',
      '写入作品正文',
      '新建时提供 workId、parentId、title、section、format、content，返回应用生成的 entryId。覆盖时提供 workId、entryId、expectedRevisionId、content，保留标题与格式。',
      object({
        workId: id,
        content: Type.String(),
        entryId: Type.Optional(id),
        expectedRevisionId: Type.Optional(id),
        parentId: Type.Optional(nullableId),
        title: Type.Optional(Type.String()),
        section: Type.Optional(section),
        format: Type.Optional(Type.Union([Type.Literal('txt'), Type.Literal('markdown')]))
      }),
      (input, context, commandId) => {
        const { entryId, ...rest } = input;
        // 混用新建与覆盖字段时由 creation 的 additionalProperties 拒绝。
        return written(
          context,
          input.workId,
          entryId !== undefined
            ? application.executeAgent(context, {
                method: 'writeContent',
                input: { ...rest, commandId, documentId: entryId } as never
              })
            : application.executeAgent(context, {
                method: 'createEntry',
                input: { ...rest, commandId, kind: 'document' } as never
              })
        );
      }
    ),
    tool(
      'work_mkdir',
      '创建作品目录',
      '在指定作品的文稿或资料分区创建目录，parentId 为 null 表示根目录。返回稳定 entryId。',
      object(newEntry),
      (input, context, commandId) =>
        written(
          context,
          input.workId,
          application.executeAgent(context, {
            method: 'createEntry',
            input: { ...input, commandId, kind: 'directory' }
          })
        )
    ),
    tool(
      'work_mv',
      '移动或改名作品条目',
      '改名提供 expectedRevisionId 和 title；移动提供读取所得 expectedParentId、expectedPosition，以及目标 parentId、beforeEntryId（null 表示末尾）。操作保留稳定 entryId。',
      object({
        ...target,
        expectedRevisionId: Type.Optional(id),
        title: Type.Optional(Type.String()),
        expectedParentId: Type.Optional(nullableId),
        expectedPosition: Type.Optional(Type.Integer({ minimum: 0 })),
        parentId: Type.Optional(nullableId),
        beforeEntryId: Type.Optional(nullableId)
      }),
      (input, context, commandId) =>
        written(
          context,
          input.workId,
          input.title !== undefined
            ? application.executeAgent(context, { method: 'renameEntry', input: { ...input, commandId } as never })
            : application.executeAgent(context, { method: 'moveEntry', input: { ...input, commandId } as never })
        )
    ),
    tool(
      'work_rm',
      '删除作品条目',
      '将文稿、资料或目录（连同其中内容）移入作品回收站，作者可以恢复。提供读取所得 expectedRevisionId。审阅模式下生成待作者接受的删除；删除本会话尚未被接受的新建条目时直接撤回该新建。',
      object(revisionTarget),
      (input, context, commandId) =>
        written(
          context,
          input.workId,
          application.executeAgent(context, { method: 'deleteEntry', input: { ...input, commandId } })
        )
    )
  ];
}
