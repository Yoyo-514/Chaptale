import type { JsonValue } from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { dirname, posix } from 'node:path';
import { Type, type Static } from 'typebox';

import { isImageFile, type CreationAgentContext, type Entry } from '@chaptale/creation/contracts';
import { fromIllustrationPlaceholders, toIllustrationPlaceholders } from '@chaptale/creation/text';

import { recordSnapshotSchema } from './records.ts';
import { relationSnapshotSchema } from './relations.ts';
import {
  agentRecord,
  agentRelation,
  entrySavedOutputSchema,
  formatSchema,
  id,
  located,
  locatedEntrySchema,
  mapResult,
  nullableId,
  object,
  sectionSchema,
  toolResult,
  type WorkToolKit
} from './shared.ts';

const target = { workId: id, entryId: id };
const revisionTarget = { ...target, expectedRevisionId: id };
const newEntry = { workId: id, parentId: nullableId, title: Type.String(), section: sectionSchema };
const workReadParameters = Type.Object(
  {
    ...target,
    offset: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: false }
);
const workSummarySchema = object({
  workId: id,
  title: Type.String(),
  kind: Type.Union([Type.Literal('novel'), Type.Literal('script')]),
  createdAt: Type.Number(),
  updatedAt: Type.Number()
});
const workLsOutputSchema = Type.Union([Type.Array(workSummarySchema), Type.Array(locatedEntrySchema)]);
const workReadOutputSchema = Type.Union([
  object({
    workId: id,
    entryId: id,
    parentId: nullableId,
    section: sectionSchema,
    kind: Type.Literal('document'),
    title: Type.String(),
    position: Type.Integer(),
    format: formatSchema,
    fileName: Type.Null(),
    wordCount: Type.Integer(),
    revisionId: id,
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    pending: Type.Boolean(),
    content: Type.String(),
    attributes: Type.Optional(
      object({
        type: Type.String(),
        aliases: Type.Array(Type.String()),
        tags: Type.Array(Type.String()),
        cover: nullableId
      })
    )
  }),
  object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String(), note: Type.String() }),
  Type.String()
]);
const workGrepOutputSchema = Type.Array(
  object({
    workId: id,
    entryId: id,
    revisionId: id,
    title: Type.String(),
    line: Type.Integer(),
    text: Type.String()
  })
);
const workSearchOutputSchema = object({
  hits: Type.Array(
    Type.Union([
      object({
        kind: Type.Literal('entry'),
        entry: locatedEntrySchema,
        pending: Type.Boolean(),
        ignoresAsOf: Type.Boolean(),
        passages: Type.Array(object({ startLine: Type.Integer(), endLine: Type.Integer(), text: Type.String() }))
      }),
      object({ kind: Type.Literal('record'), record: recordSnapshotSchema }),
      object({ kind: Type.Literal('relation'), relation: relationSnapshotSchema })
    ])
  ),
  hasMore: Type.Boolean()
});
const workRmOutputSchema = Type.Union([
  entrySavedOutputSchema,
  object({ kind: Type.Literal('trashed'), entries: Type.Array(locatedEntrySchema) })
]);

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

  /** 资料文档的类型，按 Agent 可见内容读取（审阅模式含本会话候选）。 */
  function resourceType(context: CreationAgentContext, workId: string, entry: Entry): string | null {
    if (entry.section !== 'resource' || entry.kind !== 'document') return null;
    const document = application.executeAgent(context, {
      method: 'readDocument',
      input: { workId, documentId: entry.id }
    });
    return document.ok ? (document.value.attributes?.type ?? null) : null;
  }

  function readDocument(input: Static<typeof workReadParameters>, context: CreationAgentContext) {
    return mapResult(
      application.executeAgent(context, {
        method: 'readDocument',
        input: { workId: input.workId, documentId: input.entryId }
      }),
      ({ attributes, pending, ...document }): JsonValue => {
        const start = (input.offset ?? 1) - 1;
        const lines = agentText(document).split('\n');
        const content = lines.slice(start, input.limit === undefined ? undefined : start + input.limit).join('\n');
        return {
          ...located(input.workId, document),
          pending,
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
      object({ workId: nullableId, entryId: Type.Optional(nullableId), section: Type.Optional(sectionSchema) }),
      workLsOutputSchema,
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
        '按 workId 与 entryId 读取文稿或资料，包含本会话待接受修改；pending 为 true 表示读到的是本会话待作者接受的修改，正式稿尚未改变。资料另附类型、别名、标签与封面条目 ID。offset 为从 1 开始的行号，省略时从首行读取；limit 为最多读取行数，省略时读取至末尾。图片文件条目返回图片（模型支持读图时）；其他文件条目返回路径，需用原始工具读取。Markdown 正文中的插图显示为独占一行的 [插图：说明 entry:<图片条目ID>]，以该 ID 调用 work_read 可查看图片；写入时可保留、移动或删除插图占位，不能新建。',
      parameters: workReadParameters,
      outputSchema: workReadOutputSchema,
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
      '在指定作品内按 glob 通配符匹配条目名称，包含本会话候选名称，返回稳定 ID、修订与位置。section 可限定文稿或资料分区；type 只返回该类型的资料文档（如“规划”“人物”）。',
      object({
        workId: id,
        pattern: Type.String(),
        section: Type.Optional(sectionSchema),
        type: Type.Optional(Type.String({ minLength: 1 }))
      }),
      Type.Array(locatedEntrySchema),
      async (input, context) => {
        const result = application.executeAgent(context, { method: 'listEntries', input: { workId: input.workId } });
        if (!result.ok) return result;
        const matched = result.value.filter(
          entry =>
            (!input.section || entry.section === input.section) &&
            posix.matchesGlob(entry.title, input.pattern) &&
            (input.type === undefined || resourceType(context, input.workId, entry) === input.type)
        );
        return { ok: true, value: await describe(input.workId, matched) };
      }
    ),
    tool(
      'work_grep',
      '查找作品正文',
      '按 JavaScript 正则表达式逐行查找指定作品正文，包含本会话候选。返回稳定 ID、修订、从 1 开始的行号及匹配行；section 可限定分区。',
      object({ workId: id, pattern: Type.String(), section: Type.Optional(sectionSchema) }),
      workGrepOutputSchema,
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
      '检索作品',
      [
        '按关键词检索指定作品的文稿、资料、事件和关系，包含本会话待接受修改。',
        'query 用空格分隔多个关键词：每个关键词按字面匹配，须在原文中连续出现、不跨标点和换行，全部出现才算命中；不要把几个词连写成一个。',
        'hits 按相关度排列，kind 为 entry、record 或 relation。',
        'entry 附条目元数据与 passages（命中的段落原文，startLine、endLine 为从 1 开始的行号，可作 work_read 的 offset）；文件条目只按名称匹配，只命中标题或别名时 passages 为空；pending 为 true 表示读到的是本会话待接受修改。',
        'record 与 relation 的字段同 work_record_ls、work_relation_ls，涉及资料的标题与别名也能搜到。',
        'asOf 为章节 ID 时只到该章：之后的章节不返回，事件和关系按发生位置截取、位置待定的照常返回；资料不随进度，始终返回并以 ignoresAsOf 标明。',
        'section 只留该分区的条目，此时不返回事件和关系。offset 从 0 开始，limit 为每页命中数，hasMore 表示还有下一页；需要上下文时用 work_read 读取。'
      ].join(''),
      object({
        workId: id,
        query: Type.String({ minLength: 1, pattern: '\\S' }),
        offset: Type.Integer({ minimum: 0 }),
        limit: Type.Integer({ minimum: 1 }),
        section: Type.Optional(sectionSchema),
        asOf: Type.Optional(id)
      }),
      workSearchOutputSchema,
      async (input, context) => {
        const result = application.executeAgent(context, { method: 'searchWork', input });
        if (!result.ok) return result;
        const hits: JsonValue[] = [];
        for (const hit of result.value.hits) {
          if (hit.kind === 'record') hits.push({ kind: hit.kind, record: agentRecord(hit.record) });
          else if (hit.kind === 'relation') hits.push({ kind: hit.kind, relation: agentRelation(hit.relation) });
          else {
            const { entry, pending, ignoresAsOf } = hit;
            const [described] = await describe(input.workId, [entry]);
            hits.push({
              kind: hit.kind,
              entry: described!,
              pending,
              ignoresAsOf,
              passages: hit.passages.map(({ startLine, endLine, text }) => ({
                startLine,
                endLine,
                text: entry.format === 'markdown' ? toIllustrationPlaceholders(text) : text
              }))
            });
          }
        }
        return { ok: true, value: { hits, hasMore: result.value.hasMore } };
      }
    ),
    tool(
      'work_edit',
      '精确编辑作品正文',
      '按读取所得修订替换唯一匹配的 oldText。审阅模式写入本会话候选，直接修改模式生成正式修订。插图占位规则见 work_read。',
      object({ ...revisionTarget, oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
      entrySavedOutputSchema,
      (input, context, commandId) =>
        written(
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
      '写入作品正文与资料属性',
      '新建时提供 workId、parentId、title、section、format、content，返回应用生成的 entryId。更新时提供 workId、entryId、expectedRevisionId，以及 content 或 attributes，保留标题与格式。资料可提供 attributes 的 type、aliases、tags：省略的字段保持不变，数组整体替换，空字符串清空类型，空数组清空别名或标签。封面只由作者选择。',
      object({
        workId: id,
        content: Type.Optional(Type.String()),
        entryId: Type.Optional(id),
        expectedRevisionId: Type.Optional(id),
        parentId: Type.Optional(nullableId),
        title: Type.Optional(Type.String()),
        section: Type.Optional(sectionSchema),
        format: Type.Optional(formatSchema),
        attributes: Type.Optional(
          Type.Object(
            {
              type: Type.Optional(Type.String()),
              aliases: Type.Optional(Type.Array(Type.String())),
              tags: Type.Optional(Type.Array(Type.String()))
            },
            { additionalProperties: false, minProperties: 1 }
          )
        )
      }),
      entrySavedOutputSchema,
      (input, context, commandId) => {
        const { entryId, ...fields } = input;
        const rest = {
          ...fields,
          ...(fields.content !== undefined && { content: fromIllustrationPlaceholders(fields.content) })
        };
        // 混用新建与覆盖字段时由 creation 的 additionalProperties 拒绝。
        return written(
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
      entrySavedOutputSchema,
      (input, context, commandId) =>
        written(
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
      entrySavedOutputSchema,
      (input, context, commandId) =>
        written(
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
      workRmOutputSchema,
      (input, context, commandId) =>
        written(
          input.workId,
          application.executeAgent(context, { method: 'deleteEntry', input: { ...input, commandId } })
        )
    )
  ];
}
