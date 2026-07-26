import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** tasks.run 的运行时参数边界；text 允许为空字符串，但 main 层要求 text 与附件至少其一非空。 */
export const TaskRunPayloadSchema = Type.Object(
  {
    /** renderer 预生成的请求标识：运行期间取消的路由键（await 式 IPC 无法先返回 runId）。 */
    requestId: Type.String({ minLength: 1 }),
    personaId: Type.String({ minLength: 1 }),
    brief: Type.String(),
    text: Type.String(),
    contextFilePaths: Type.Optional(Type.Array(Type.String()))
  },
  { additionalProperties: false }
);

export const TaskRunArgsSchema = Type.Tuple([TaskRunPayloadSchema]);
export const TaskRunArgsValidator = Compile(TaskRunArgsSchema);

export const TaskCancelPayloadSchema = Type.Object(
  { requestId: Type.String({ minLength: 1 }) },
  { additionalProperties: false }
);

export const TaskCancelArgsSchema = Type.Tuple([TaskCancelPayloadSchema]);
export const TaskCancelArgsValidator = Compile(TaskCancelArgsSchema);

export const TaskListRunsPayloadSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    personaId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

export const TaskListRunsArgsSchema = Type.Tuple([TaskListRunsPayloadSchema]);
export const TaskListRunsArgsValidator = Compile(TaskListRunsArgsSchema);

export const TaskReadRunOutputArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const TaskReadRunOutputArgsValidator = Compile(TaskReadRunOutputArgsSchema);

/** 单次 persona 运行的可追溯记录；字段与 main 侧 AgentRunRecord 结构对齐。 */
export const AgentRunRecordSchema = Type.Object(
  {
    id: Type.String(),
    personaId: Type.String(),
    execution: Type.Union([Type.Literal('chat'), Type.Literal('task')]),
    trigger: Type.Union([Type.Literal('user'), Type.Literal('delegate'), Type.Literal('ui-action')]),
    /** 委派/界面动作发起时，指向宿主主对话 session。 */
    parentSessionId: Type.Optional(Type.String()),
    promptTemplateHash: Type.String(),
    inputDigest: Type.Object(
      {
        brief: Type.Optional(Type.String()),
        files: Type.Optional(Type.Array(Type.String()))
      },
      { additionalProperties: false }
    ),
    /** 输出体的 workspace 相对路径。 */
    outputRef: Type.Optional(Type.String()),
    memoryRefs: Type.Array(Type.String()),
    status: Type.Union([
      Type.Literal('success'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
      Type.Literal('timeout')
    ]),
    usage: Type.Object({ inputTokens: Type.Number(), outputTokens: Type.Number() }, { additionalProperties: false }),
    /** ISO 8601 时间串。 */
    createdAt: Type.String(),
    completedAt: Type.Optional(Type.String())
  },
  { additionalProperties: false }
);

/** tasks.listRuns 的返回结果：记录列表 + 坏行诊断。 */
export const AgentRunsListResultSchema = Type.Object(
  {
    records: Type.Array(AgentRunRecordSchema),
    diagnostics: Type.Array(
      Type.Object(
        {
          filePath: Type.String(),
          line: Type.Number(),
          message: Type.String()
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export const AgentRunsListResultValidator = Compile(AgentRunsListResultSchema);
