import { Type, type Static } from 'typebox';

/** todo 项状态：pending 未开始 / in_progress 进行中 / completed 已完成。 */
export const todoStatuses = ['pending', 'in_progress', 'completed'] as const;

export type TodoStatus = (typeof todoStatuses)[number];

/** 单条 todo 项；id 由模型给定且在整表替换间保持稳定，content 是一句可执行描述。 */
export const TodoItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')])
  },
  { additionalProperties: false }
);

export type TodoItem = Static<typeof TodoItemSchema>;
