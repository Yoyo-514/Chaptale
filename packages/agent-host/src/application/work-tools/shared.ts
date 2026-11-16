import type { JsonValue } from '@earendil-works/pi-ai';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';

import type { CreationApplication } from '@chaptale/creation/application';
import type {
  AgentWriteResult,
  CreationAgentContext,
  CreationResult,
  Entry,
  RecordPlacement,
  RecordSnapshot,
  RecordSource,
  RelationSnapshot
} from '@chaptale/creation/contracts';

import type { EditMode } from '../../protocol.ts';

export const id = Type.String({ minLength: 1 });
export const nullableId = Type.Union([id, Type.Null()]);
export const sectionSchema = Type.Union([Type.Literal('manuscript'), Type.Literal('resource')]);
export const formatSchema = Type.Union([Type.Literal('txt'), Type.Literal('markdown')]);
// OpenAI 兼容接口要求工具参数顶层为 type: object，不能用 Union；分支字段设为可选，组合由 creation 的参数校验判定。
export const object = <T extends Record<string, TSchema>>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });

export const locatedEntrySchema = object({
  workId: id,
  entryId: id,
  parentId: nullableId,
  section: sectionSchema,
  kind: Type.Union([Type.Literal('directory'), Type.Literal('document'), Type.Literal('file')]),
  title: Type.String(),
  position: Type.Integer(),
  format: Type.Union([formatSchema, Type.Null()]),
  fileName: nullableId,
  wordCount: Type.Integer(),
  revisionId: id,
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  file: Type.Optional(
    object({
      image: Type.Boolean(),
      size: Type.Optional(Type.Number()),
      path: Type.Optional(Type.String()),
      error: Type.Optional(Type.String())
    })
  )
});

export const entrySavedOutputSchema = object({
  kind: Type.Union([Type.Literal('saved'), Type.Literal('pending')]),
  entry: locatedEntrySchema
});

export const recordSourceSchema = Type.Union([
  object({ kind: Type.Literal('chapter'), chapterId: id, revisionId: id }),
  object({ kind: Type.Literal('author') })
]);

export const recordPlacementSchema = Type.Union([
  object({ kind: Type.Literal('chapter'), chapterId: id }),
  object({ kind: Type.Literal('opening') }),
  object({ kind: Type.Literal('undetermined') })
]);

export function located<T extends Entry>(workId: string, entry: T) {
  const { id: entryId, ...metadata } = entry;
  return { workId, entryId, ...metadata };
}

export function agentRecord<T extends RecordSnapshot>(record: T) {
  const { id: recordId, ...fields } = record;
  return { recordId, ...fields };
}

export function agentRelation<T extends RelationSnapshot>(relation: T) {
  const { id: relationId, ...fields } = relation;
  return { relationId, ...fields };
}

/** 发生位置：章节 ID，或 opening（开篇之前）、undetermined（待定）。 */
export function placementOf(value: string): RecordPlacement {
  return value === 'opening' || value === 'undetermined' ? { kind: value } : { kind: 'chapter', chapterId: value };
}

/** 来源：章节 ID 附读取所得修订，null 表示作者在对话中补充。 */
export function sourceOf(sourceId: string | null, revisionId: string | undefined): RecordSource {
  return sourceId === null ? { kind: 'author' } : { kind: 'chapter', chapterId: sourceId, revisionId: revisionId! };
}

export function toolResult(result: CreationResult<JsonValue>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    details: result,
    ...(result.ok && { structuredContent: result.value }),
    isError: !result.ok
  };
}

export function mapResult<T, U>(result: CreationResult<T>, map: (value: T) => U): CreationResult<U> {
  return result.ok ? { ok: true, value: map(result.value) } : result;
}

/** 各领域工具共用的宿主能力：会话上下文、写入命令与结果呈现。 */
export interface WorkToolKit {
  application: CreationApplication;
  mode: (sessionId: string) => EditMode;
  written: (workId: string, result: CreationResult<AgentWriteResult>) => CreationResult<JsonValue>;
  executeWrite: (
    context: CreationAgentContext,
    command: { method: string; input: unknown }
  ) => CreationResult<AgentWriteResult>;
  tool: <S extends TSchema>(
    name: string,
    label: string,
    description: string,
    parameters: S,
    outputSchema: TSchema,
    execute: (
      input: Parameters<ToolDefinition<S>['execute']>[1],
      context: CreationAgentContext,
      commandId: string
    ) => CreationResult<JsonValue> | Promise<CreationResult<JsonValue>>
  ) => ToolDefinition;
}

export function workToolKit(application: CreationApplication, mode: (sessionId: string) => EditMode): WorkToolKit {
  function written(workId: string, result: CreationResult<AgentWriteResult>) {
    return mapResult(result, (value): JsonValue => {
      if (value.kind === 'trashed')
        return { kind: value.kind, entries: value.entries.map(entry => located(workId, entry)) };
      if (value.kind === 'saved') return { kind: value.kind, entry: located(workId, value.entry) };
      if (value.kind === 'record')
        return { kind: value.removed ? 'removed' : 'saved', record: agentRecord(value.record) };
      if (value.kind === 'relation')
        return { kind: value.removed ? 'removed' : 'saved', relation: agentRelation(value.relation) };
      const { change } = value;
      if (change.target === 'record')
        return { kind: value.kind, ...(change.deleted && { removed: true }), record: agentRecord(change.candidate) };
      if (change.target === 'relation')
        return {
          kind: value.kind,
          ...(change.deleted && { removed: true }),
          relation: agentRelation(change.candidate)
        };
      return { kind: value.kind, entry: located<Entry>(workId, change.candidate) };
    });
  }

  /**
   * 模型的写入参数按字段组合决定命令，由 creation 入口按命令 schema 校验并拒绝混用字段；
   * 这里只承担写入命令（writeContent、createEntry、renameEntry、moveEntry）的统一输出类型。
   */
  function executeWrite(context: CreationAgentContext, command: { method: string; input: unknown }) {
    return application.executeAgent(context, command) as CreationResult<AgentWriteResult>;
  }

  function tool<S extends TSchema>(
    name: string,
    label: string,
    description: string,
    parameters: S,
    outputSchema: TSchema,
    execute: (
      input: Parameters<ToolDefinition<S>['execute']>[1],
      context: CreationAgentContext,
      commandId: string
    ) => CreationResult<JsonValue> | Promise<CreationResult<JsonValue>>
  ): ToolDefinition {
    return defineTool({
      name,
      label,
      description,
      parameters,
      outputSchema,
      async execute(toolCallId, input, signal, _onUpdate, ctx) {
        signal?.throwIfAborted();
        const sessionId = ctx.sessionManager.getSessionId();
        return toolResult(
          await execute(input, { sessionId, mode: mode(sessionId) }, JSON.stringify([sessionId, toolCallId]))
        );
      }
    });
  }

  return { application, mode, written, executeWrite, tool };
}
