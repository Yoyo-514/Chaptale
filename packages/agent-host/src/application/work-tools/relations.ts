import type { JsonValue } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static, type TSchema } from 'typebox';

import type { MilestoneInput, MilestonePatch, RelationMilestone } from '@chaptale/creation/contracts';

import { agentRelation, id, mapResult, nullableId, object, placementOf, sourceOf, type WorkToolKit } from './shared.ts';

const pair = <T extends TSchema>(item: T) => Type.Array(item, { minItems: 2, maxItems: 2 });
const relationWriteParameters = object({
  workId: id,
  basis: Type.String(),
  relationId: Type.Optional(id),
  expectedRevisionId: Type.Optional(id),
  remove: Type.Optional(Type.Literal(true)),
  resourceIds: Type.Optional(pair(id)),
  type: Type.Optional(Type.String({ minLength: 1 })),
  directed: Type.Optional(Type.Boolean()),
  titles: Type.Optional(pair(Type.String())),
  milestones: Type.Optional(
    Type.Array(
      object({
        milestoneId: Type.Optional(id),
        remove: Type.Optional(Type.Literal(true)),
        kind: Type.Optional(Type.Union([Type.Literal('start'), Type.Literal('end')])),
        sourceId: Type.Optional(nullableId),
        sourceRevisionId: Type.Optional(id),
        placement: Type.Optional(id),
        storyTime: Type.Optional(Type.String())
      })
    )
  )
});
type MilestoneParameter = NonNullable<Static<typeof relationWriteParameters>['milestones']>[number];

/**
 * 把一条建立或结束的参数补全为整条内容：修改时未提供的字段沿用当前值；
 * 新增时省略 sourceId 表示作者补充，缺少的种类或发生位置交由 creation 参数校验拒绝。
 */
function milestoneOf(input: MilestoneParameter, current: RelationMilestone | undefined) {
  const placement = input.placement ?? input.sourceId;
  return {
    id: input.milestoneId ?? null,
    kind: input.kind ?? current?.kind,
    source:
      input.sourceId === undefined && current
        ? current.source
        : sourceOf(input.sourceId ?? null, input.sourceRevisionId),
    placement: placement ? placementOf(placement) : current?.placement,
    storyTime: input.storyTime ?? current?.storyTime ?? ''
  } as MilestoneInput;
}

/** 资料之间关系的列出与写入。 */
export function relationTools({ application, written, executeWrite, tool }: WorkToolKit): ToolDefinition[] {
  return [
    tool(
      'work_relation_ls',
      '列出作品关系',
      [
        '列出资料之间的关系及作品中已用的关系类型；审阅模式包含本会话待接受修改，pending 为 true 表示该关系尚待作者接受。resourceId 只列涉及该资料的关系。',
        'state 为截至 asOf 章节（省略则为全书）最近一条建立或结束得出的状态：active（存续）、ended（已结束）、undetermined（建立与结束都待定）。',
        'milestones 按发生位置排列，kind 为 start（建立）或 end（结束）；directed 为 true 时 titles 依次是 resourceIds 双方的称谓。建立／结束的 sourceChanged 为 true 表示出处章节在核对后又改过正文，source.revisionId 是此前核对的版本；只有作者能确认整章记录仍适用。'
      ].join(''),
      object({ workId: id, resourceId: Type.Optional(nullableId), asOf: Type.Optional(nullableId) }),
      (input, context) =>
        mapResult(
          application.executeAgent(context, {
            method: 'listRelations',
            input: { workId: input.workId, resourceId: input.resourceId ?? null, asOf: input.asOf ?? null }
          }),
          (value): JsonValue => ({ relations: value.relations.map(agentRelation), types: value.types })
        )
    ),
    tool(
      'work_relation_write',
      '写入作品关系',
      [
        '新建、修改或移除两份资料之间的一条关系。basis 填写所依据的章节原文片段，供作者核对。',
        '新建提供 resourceIds（两份不同资料，新资料先用 work_write 在资料区新建）、type、directed、titles 与至少一条 kind 为 start 的 milestones。type 可沿用 work_relation_ls 返回的 types，也可按原文自拟（如“舅甥”“主仆”）；同名类型的 directed 须与 types 一致。',
        'milestones 每条：出自章节时提供 sourceId 与读取所得 sourceRevisionId（审阅模式下本会话改写过的章节用读到的待接受版本），省略 sourceId 表示作者在对话中补充；placement 为发生章节 ID、opening 或 undetermined，省略则取 sourceId 章节。',
        '修改提供 relationId、expectedRevisionId 与要改的字段，未提供的字段保持不变；milestones 只列出改动：新增省略 milestoneId，修改提供 milestoneId 与要改的字段，移除提供 milestoneId 与 remove: true，未列出的保持不变。',
        '移除整条关系提供 relationId、expectedRevisionId 与 remove: true。审阅模式写入本会话候选；移除本会话尚未接受的新建关系时直接撤回。'
      ].join(''),
      relationWriteParameters,
      (input, context, commandId) => {
        const { workId, basis, relationId, expectedRevisionId } = input;
        const fields = {
          ...(input.resourceIds && { resourceIds: input.resourceIds as [string, string] }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.directed !== undefined && { directed: input.directed }),
          ...(input.titles && { titles: input.titles as [string, string] })
        };
        const milestones = input.milestones ?? [];
        if (relationId === undefined)
          return written(
            context,
            workId,
            executeWrite(context, {
              method: 'createRelation',
              input: {
                commandId,
                workId,
                ...fields,
                milestones: milestones.map(item => milestoneOf(item, undefined)),
                basis
              }
            })
          );
        if (input.remove)
          return written(
            context,
            workId,
            executeWrite(context, {
              method: 'removeRelation',
              input: { commandId, workId, relationId, expectedRevisionId, basis }
            })
          );
        const listed = application.executeAgent(context, {
          method: 'listRelations',
          input: { workId, resourceId: null, asOf: null }
        });
        if (!listed.ok) return listed;
        const current = listed.value.relations.find(relation => relation.id === relationId);
        if (!current) return { ok: false, error: { code: 'invalid-request', message: '关系不存在' } };
        const patches: MilestonePatch[] = [];
        for (const item of milestones) {
          if (item.remove) {
            patches.push({ id: item.milestoneId!, remove: true });
            continue;
          }
          const existing = current.milestones.find(milestone => milestone.id === item.milestoneId);
          if (item.milestoneId !== undefined && !existing)
            return { ok: false, error: { code: 'invalid-request', message: '要修改的建立或结束不存在' } };
          patches.push(milestoneOf(item, existing));
        }
        return written(
          context,
          workId,
          executeWrite(context, {
            method: 'updateRelation',
            input: { commandId, workId, relationId, expectedRevisionId, ...fields, milestones: patches, basis }
          })
        );
      }
    )
  ];
}
