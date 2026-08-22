import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { SessionIdSchema } from './sessions';

/**
 * 运行停在这里的原因；只有 `natural` 是模型自己收的尾，其余三种都是引擎替它做的决定。
 *
 * 与 main 侧 `AgentStopReason` 同源，差别只在少一个 `aborted`——用户取消走 `cancelled`
 * 终态，不占 `completed` 的位置。两侧取值一旦漂移，Main 把停因赋进本字段时即编译失败。
 */
export const RunStopReasonSchema = Type.Union([
  Type.Literal('natural'),
  Type.Literal('step-limit'),
  Type.Literal('token-budget'),
  Type.Literal('output-truncated')
]);

/** Agent 运行的唯一终态；失败信息必须完整，便于 Renderer 做确定性处理。 */
export const RunEndSchema = Type.Union([
  // stopReason 必填：护栏截停与自然收尾在界面上是两件事，留可选就等于允许再次丢掉它。
  Type.Object({ status: Type.Literal('completed'), stopReason: RunStopReasonSchema }, { additionalProperties: false }),
  Type.Object({ status: Type.Literal('cancelled') }, { additionalProperties: false }),
  Type.Object(
    {
      status: Type.Literal('failed'),
      code: Type.String(),
      message: Type.String(),
      retryable: Type.Boolean()
    },
    { additionalProperties: false }
  )
]);

/** Main 推送给单次 Renderer 运行的终态事件。 */
export const AgentEndEventSchema = Type.Object(
  {
    runId: Type.String(),
    end: RunEndSchema
  },
  { additionalProperties: false }
);
export const AgentEndEventValidator = Compile(AgentEndEventSchema);

/** invoke 确认响应边界：只允许 Renderer 需要关联后续事件的 runId。 */
export const AgentRunResultSchema = Type.Object(
  {
    runId: Type.String()
  },
  { additionalProperties: false }
);
export const AgentRunResultValidator = Compile(AgentRunResultSchema);

/** Runtime 清空队列后允许跨 IPC 返回的项目级消息集合。 */
export const AgentClearedQueueSchema = Type.Object(
  {
    steering: Type.Array(Type.String()),
    followUp: Type.Array(Type.String())
  },
  { additionalProperties: false }
);

/** clearPendingMessages invoke 的响应边界，防止 Runtime 坏结构透传给 Renderer。 */
export const AgentQueueClearResultSchema = Type.Object(
  {
    runId: Type.String(),
    queue: AgentClearedQueueSchema
  },
  { additionalProperties: false }
);
export const AgentQueueClearResultValidator = Compile(AgentQueueClearResultSchema);

/** Agent IPC 的运行时参数边界；拒绝额外字段，避免 Renderer 绕过公开契约传递内部选项。 */
export const AgentStartPayloadSchema = Type.Object(
  {
    runId: Type.String(),
    query: Type.String(),
    sessionId: Type.Optional(SessionIdSchema),
    branchFromEntryId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    contextFilePaths: Type.Optional(Type.Array(Type.String())),
    reuseUserEntryId: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

export const AgentStartArgsSchema = Type.Tuple([AgentStartPayloadSchema]);
export const AgentStartArgsValidator = Compile(AgentStartArgsSchema);

export const AgentCancelArgsSchema = Type.Tuple([Type.String()]);
export const AgentCancelArgsValidator = Compile(AgentCancelArgsSchema);

/** Renderer 向活跃 Agent 运行追加 steer 时使用的参数边界。 */
export const AgentSteerPayloadSchema = Type.Object(
  {
    runId: Type.String(),
    query: Type.String({ minLength: 1 }),
    contextFilePaths: Type.Optional(Type.Array(Type.String()))
  },
  { additionalProperties: false }
);

/** steer IPC 的参数元组 schema。 */
export const AgentSteerArgsSchema = Type.Tuple([AgentSteerPayloadSchema]);
export const AgentSteerArgsValidator = Compile(AgentSteerArgsSchema);

/** 清空当前运行待处理消息时使用的参数边界。 */
export const AgentClearPendingMessagesPayloadSchema = Type.Object(
  { runId: Type.String() },
  { additionalProperties: false }
);

/** 清空待处理消息 IPC 的参数元组 schema。 */
export const AgentClearPendingMessagesArgsSchema = Type.Tuple([AgentClearPendingMessagesPayloadSchema]);
export const AgentClearPendingMessagesArgsValidator = Compile(AgentClearPendingMessagesArgsSchema);

export const AgentInspectContextFilesArgsSchema = Type.Tuple([Type.Array(Type.String())]);
export const AgentInspectContextFilesArgsValidator = Compile(AgentInspectContextFilesArgsSchema);

/** 查询会话上下文水位；sessionId 必须绑定现有会话。 */
export const AgentGetContextPressureArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const AgentGetContextPressureArgsValidator = Compile(AgentGetContextPressureArgsSchema);

/** 作者确认执行会话压缩；只接收 sessionId，不允许 Renderer 注入摘要指令。 */
export const AgentCompactSessionArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const AgentCompactSessionArgsValidator = Compile(AgentCompactSessionArgsSchema);
