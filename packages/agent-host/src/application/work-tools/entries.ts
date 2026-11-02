import type { JsonValue } from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { dirname, posix } from 'node:path';
import { Type, type Static } from 'typebox';

import { isImageFile, type CreationAgentContext, type Entry } from '@chaptale/creation/contracts';
import { fromIllustrationPlaceholders, toIllustrationPlaceholders } from '@chaptale/creation/text';

import { id, located, mapResult, nullableId, object, toolResult, type WorkToolKit } from './shared.ts';

const target = { workId: id, entryId: id };
const revisionTarget = { ...target, expectedRevisionId: id };
const section = Type.Union([Type.Literal('manuscript'), Type.Literal('resource')]);
const newEntry = { workId: id, parentId: nullableId, title: Type.String(), section };
const workReadParameters = Type.Object(
  {
    ...target,
    offset: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: false }
);

/** Markdown 插图对 Agent 显示为文字占位，写入时还原。 */
function agentText(document: { format: 'txt' | 'markdown'; content: string }) {
  return document.format === 'markdown' ? toIllustrationPlaceholders(document.content) : document.content;
}

/** 作品、目录与正文条目的浏览、读取、检索与写入。 */
export function entryTools({ application, mode, written, executeWrite, tool }: WorkToolKit): ToolDefinition[] {
  /** 条目元数据；文件条目附带文件名、是否图片、当前大小与路径，供 Agent 用原始工具读取。 */
  async function describe(workId: string, entries: Entry[]): Promise<JsonValue[]> {
    const described: JsonValue[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'file') {
        described.push(located(workId, entry));
        continue;
      }
      const file = await application.execute({
        method: 'locateFile',
        input: { workId, entryId: entry.id, trashed: false }
      });
      described.push({
        ...located(workId, entry),
        file: file.ok
          ? { image: isImageFile(entry), size: file.value.size, path: file.value.path }
          : { image: isImageFile(entry), error: file.error.message }
      });
    }
    return described;
  }

  function readDocument(input: Static<typeof workReadParameters>, context: CreationAgentContext) {
    return mapResult(
      application.executeAgent(context, {
        method: 'readDocument',
        input: { workId: input.workId, documentId: input.entryId }
      }),
      ({ attributes, ...document }): JsonValue => {
        const start = (input.offset ?? 1) - 1;
        const lines = agentText(document).split('\n');
        const content = lines.slice(start, input.limit === undefined ? undefined : start + input.limit).join('\n');
        return {
          ...located(input.workId, document),
          content,
          ...(attributes && {
            attributes: {
              type: attributes.type,
              aliases: [...attributes.aliases],
              tags: [...attributes.tags],
              cover: attributes.cover
            }
          })
        };
      }
    );
  }

  return [
    tool(
      'work_ls',
      '浏览作品',
      'workId 为 null 时列出作品；提供作品 ID 时列出 entryId 目录的直接子条目，entryId 缺省或为 null 表示根目录。返回稳定 ID 与修订、位置元数据；资料中的文件条目（kind 为 file）附带是否图片、大小与文件路径。',
      object({ workId: nullableId, entryId: Type.Optional(nullableId), section: Type.Optional(section) }),
      async (input, context) => {
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
          value: await describe(
            workId,
            result.value.filter(
              entry => entry.parentId === parentId && (!input.section || entry.section === input.section)
            )
          )
        };
      }
    ),
    defineTool({
      name: 'work_read',
      label: '读取作品正文',
      description:
        '按 workId 与 entryId 读取文稿或资料，包含本会话待接受修改；资料另附类型、别名、标签与封面条目 ID。offset 为从 1 开始的行号，省略时从首行读取；limit 为最多读取行数，省略时读取至末尾。图片文件条目返回图片（模型支持读图时）；其他文件条目返回路径，需用原始工具读取。Markdown 正文中的插图显示为独占一行的 [插图：说明 entry:<图片条目ID>]，以该 ID 调用 work_read 可查看图片；写入时可保留、移动或删除插图占位，不能新建。',
      parameters: workReadParameters,
      async execute(toolCallId, input, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        const sessionId = ctx.sessionManager.getSessionId();
        const context = { sessionId, mode: mode(sessionId) };
        const entries = application.executeAgent(context, { method: 'listEntries', input: { workId: input.workId } });
        const entry = entries.ok ? entries.value.find(item => item.id === input.entryId) : undefined;
        if (entry?.kind !== 'file') return toolResult(readDocument(input, context));
        const file = await application.execute({
          method: 'locateFile',
          input: { workId: input.workId, entryId: entry.id, trashed: false }
        });
        if (!file.ok) return toolResult(file);
        if (!isImageFile(entry))
          return toolResult({
            ok: false,
            error: { code: 'failed', message: `这个文件条目不是图片，需要时用原始工具读取：${file.value.path}` }
          });
        // 图片读取复用 pi 原生 read 工具：按模型限制缩放，不支持读图的模型得到说明文字。
        return createReadToolDefinition(dirname(file.value.path)).execute(
          toolCallId,
          { path: file.value.path },
          signal,
          onUpdate,
          ctx
        );
      }
    }),
    tool(
      'work_find',
      '查找作品条目',
      '在指定作品内按 glob 通配符匹配条目名称，包含本会话候选名称，返回稳定 ID、修订与位置。section 可限定文稿或资料分区。',
      object({ workId: id, pattern: Type.String(), section: Type.Optional(section) }),
      async (input, context) => {
        const result = application.executeAgent(context, { method: 'listEntries', input: { workId: input.workId } });
        if (!result.ok) return result;
        const matched = result.value.filter(
          entry => (!input.section || entry.section === input.section) && posix.matchesGlob(entry.title, input.pattern)
        );
        return { ok: true, value: await describe(input.workId, matched) };
      }
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
          const lines = agentText(result.value).split('\n');
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
      async (input, context) => {
        const result = application.executeAgent(context, { method: 'searchDocuments', input });
        if (!result.ok) return result;
        return {
          ok: true,
          value: { entries: await describe(input.workId, result.value.entries), hasMore: result.value.hasMore }
        };
      }
    ),
    tool(
      'work_edit',
      '精确编辑作品正文',
      '按读取所得修订替换唯一匹配的 oldText。审阅模式写入本会话候选，直接修改模式生成正式修订。插图占位规则见 work_read。',
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
              oldText: fromIllustrationPlaceholders(input.oldText),
              newText: fromIllustrationPlaceholders(input.newText)
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
        const { entryId, ...fields } = input;
        const rest = { ...fields, content: fromIllustrationPlaceholders(fields.content) };
        // 混用新建与覆盖字段时由 creation 的 additionalProperties 拒绝。
        return written(
          context,
          input.workId,
          entryId !== undefined
            ? executeWrite(context, {
                method: 'writeContent',
                input: { ...rest, commandId, documentId: entryId }
              })
            : executeWrite(context, {
                method: 'createEntry',
                input: { ...rest, commandId, kind: 'document' }
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
            ? executeWrite(context, { method: 'renameEntry', input: { ...input, commandId } })
            : executeWrite(context, { method: 'moveEntry', input: { ...input, commandId } })
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
