import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 会话过滤参数：查询活跃子任务。 */
export const SubagentListActiveArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const SubagentListActiveArgsValidator = Compile(SubagentListActiveArgsSchema);

/** 取消参数：requestId。 */
export const SubagentCancelArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const SubagentCancelArgsValidator = Compile(SubagentCancelArgsSchema);

const SubagentStateSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('success'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('timeout')
]);

const SubagentUsageSchema = Type.Object(
  {
    inputTokens: Type.Number(),
    outputTokens: Type.Number()
  },
  { additionalProperties: false }
);

/** 槽位状态机推送事件的运行时边界；结构与 shared 的 SubagentSlotEvent 对齐。 */
export const SubagentSlotEventSchema = Type.Object(
  {
    requestId: Type.String(),
    personaId: Type.String(),
    sessionId: Type.Optional(Type.String()),
    state: SubagentStateSchema,
    usage: Type.Optional(SubagentUsageSchema),
    runId: Type.Optional(Type.String()),
    outputRef: Type.Optional(Type.String()),
    error: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);
export const SubagentSlotEventValidator = Compile(SubagentSlotEventSchema);
