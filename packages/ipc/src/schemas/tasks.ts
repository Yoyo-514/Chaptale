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
