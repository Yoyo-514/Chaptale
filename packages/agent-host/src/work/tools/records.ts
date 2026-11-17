import type { JsonValue } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import {
  agentRecord,
  id,
  mapResult,
  nullableId,
  object,
  placementOf,
  recordPlacementSchema,
  recordSourceSchema,
  sourceOf,
  type WorkToolKit
} from './shared.ts';

const recordSnapshotSchema = object({
  recordId: id,
  revisionId: Type.Optional(nullableId),
  resourceIds: Type.Array(id),
  text: Type.String(),
  source: recordSourceSchema,
  sourceChanged: Type.Optional(Type.Boolean()),
  placement: recordPlacementSchema,
  storyTime: Type.String(),
  pending: Type.Optional(Type.Boolean())
});
const recordWriteOutputSchema = object({
  kind: Type.Union([Type.Literal('saved'), Type.Literal('removed'), Type.Literal('pending')]),
  removed: Type.Optional(Type.Boolean()),
  record: recordSnapshotSchema
});

const recordWriteParameters = object({
  workId: id,
  basis: Type.String(),
  recordId: Type.Optional(id),
  expectedRevisionId: Type.Optional(id),
  remove: Type.Optional(Type.Literal(true)),
  resourceIds: Type.Optional(Type.Array(id, { minItems: 1 })),
  text: Type.Optional(Type.String({ minLength: 1 })),
  sourceId: Type.Optional(nullableId),
  sourceRevisionId: Type.Optional(id),
  placement: Type.Optional(id),
  storyTime: Type.Optional(Type.String())
});

/** 事件的列出与写入。 */
export function recordTools({ application, written, executeWrite, tool }: WorkToolKit): ToolDefinition[] {
  return [
    tool(
      'work_record_ls',
      '列出作品事件',
      '列出作品中的事件，按发生位置排序；审阅模式包含本会话待接受修改，pending 为 true 表示该事件尚待作者接受。resourceId 只列涉及该资料的事件；sourceId 只列出自该章的事件；asOf 为章节 ID 时只列截至该章发生的事件与待定事件。placement 为 chapter（附 chapterId）、opening（开篇之前）或 undetermined（待定）。sourceChanged 为 true 表示出处章节在核对后又改过正文，source.revisionId 是此前核对的版本；只有作者能确认整章记录仍适用。',
      object({
        workId: id,
        resourceId: Type.Optional(nullableId),
        sourceId: Type.Optional(nullableId),
        asOf: Type.Optional(nullableId)
      }),
      Type.Array(recordSnapshotSchema),
      (input, context) =>
        mapResult(
          application.executeAgent(context, {
            method: 'listRecords',
            input: {
              workId: input.workId,
              resourceId: input.resourceId ?? null,
              sourceId: input.sourceId ?? null,
              asOf: input.asOf ?? null
            }
          }),
          (records): JsonValue => records.map(agentRecord)
        )
    ),
    tool(
      'work_record_write',
      '写入作品事件',
      [
        '新建、修改或移除一条事件。basis 填写所依据的章节原文片段，供作者核对。',
        '新建提供 resourceIds（涉及的资料条目 ID，新资料先用 work_write 在资料区新建）与 text；出自章节时提供 sourceId 与读取所得 sourceRevisionId（审阅模式下本会话改写过的章节用读到的待接受版本），省略 sourceId 表示作者在对话中补充。',
        'placement 为发生章节 ID、opening（开篇之前）或 undetermined（待定），新建时省略则取 sourceId 章节。',
        '修改提供 recordId、expectedRevisionId 与要改的字段，未提供的字段保持不变；sourceId 为 null 表示改为作者补充。移除提供 recordId、expectedRevisionId 与 remove: true。',
        '审阅模式写入本会话候选；移除本会话尚未接受的新建事件时直接撤回。'
      ].join(''),
      recordWriteParameters,
      recordWriteOutputSchema,
      (input, context, commandId) => {
        const { workId, basis, recordId, expectedRevisionId } = input;
        if (input.remove)
          return written(
            workId,
            executeWrite(context, {
              method: 'removeRecord',
              input: { commandId, workId, recordId, expectedRevisionId, basis }
            })
          );
        const source = (sourceId: string | null) => sourceOf(sourceId, input.sourceRevisionId);
        if (recordId === undefined) {
          const placement = input.placement ?? input.sourceId;
          if (!placement)
            return { ok: false, error: { code: 'invalid-request', message: '未提供 sourceId 时需指定 placement' } };
          return written(
            workId,
            executeWrite(context, {
              method: 'createRecord',
              input: {
                commandId,
                workId,
                resourceIds: input.resourceIds,
                text: input.text,
                source: source(input.sourceId ?? null),
                placement: placementOf(placement),
                storyTime: input.storyTime ?? '',
                basis
              }
            })
          );
        }
        const listed = application.executeAgent(context, {
          method: 'listRecords',
          input: { workId, resourceId: null, sourceId: null, asOf: null }
        });
        if (!listed.ok) return listed;
        const current = listed.value.find(record => record.id === recordId);
        if (!current) return { ok: false, error: { code: 'invalid-request', message: '事件不存在' } };
        return written(
          workId,
          executeWrite(context, {
            method: 'updateRecord',
            input: {
              commandId,
              workId,
              recordId,
              expectedRevisionId,
              resourceIds: input.resourceIds ?? current.resourceIds,
              text: input.text ?? current.text,
              source: input.sourceId === undefined ? current.source : source(input.sourceId),
              placement: input.placement === undefined ? current.placement : placementOf(input.placement),
              storyTime: input.storyTime ?? current.storyTime,
              basis
            }
          })
        );
      }
    )
  ];
}
