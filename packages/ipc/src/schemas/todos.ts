import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { TodoItemSchema } from '@chaptale/shared';

import { SessionIdSchema } from './sessions';

export const TodosGetArgsSchema = Type.Tuple([SessionIdSchema]);
export const TodosGetArgsValidator = Compile(TodosGetArgsSchema);

/** todo 清单整表推送事件的运行时边界；复用 shared 的 TodoItemSchema 避免结构漂移。 */
export const TodosUpdatedEventSchema = Type.Object(
  {
    sessionId: Type.String(),
    items: Type.Array(TodoItemSchema)
  },
  { additionalProperties: false }
);
export const TodosUpdatedEventValidator = Compile(TodosUpdatedEventSchema);
