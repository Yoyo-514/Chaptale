import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** Agent IPC 的运行时参数边界；拒绝额外字段，避免 Renderer 绕过公开契约传递内部选项。 */
export const AgentStartPayloadSchema = Type.Object(
  {
    runId: Type.String(),
    query: Type.String(),
    sessionId: Type.Optional(Type.String()),
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
