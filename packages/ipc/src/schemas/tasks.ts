import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** tasks.run 的运行时参数边界；拒绝额外字段，防止 Renderer 传递未公开选项。 */
export const TaskRunPayloadSchema = Type.Object(
  {
    personaId: Type.String({ minLength: 1 }),
    brief: Type.String(),
    text: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

export const TaskRunArgsSchema = Type.Tuple([TaskRunPayloadSchema]);
export const TaskRunArgsValidator = Compile(TaskRunArgsSchema);

export const TaskCancelPayloadSchema = Type.Object(
  { runId: Type.String({ minLength: 1 }) },
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
