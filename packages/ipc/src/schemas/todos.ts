import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { TodoItemSchema } from '@chaptale/shared';

import { SessionIdSchema } from './sessions';

export const TodosGetArgsSchema = Type.Tuple([SessionIdSchema]);
export const TodosGetArgsValidator = Compile(TodosGetArgsSchema);

/** 用户手动清理范围：all 清空整表；completed 只移除已完成项。 */
export const TodosClearPayloadSchema = Type.Object(
  {
    sessionId: SessionIdSchema,
    scope: Type.Union([Type.Literal('all'), Type.Literal('completed')])
  },
  { additionalProperties: false }
);
export const TodosClearArgsSchema = Type.Tuple([TodosClearPayloadSchema]);
export const TodosClearArgsValidator = Compile(TodosClearArgsSchema);

/** todo 清单整表推送事件的运行时边界；复用 shared 的 TodoItemSchema 避免结构漂移。 */
export const TodosUpdatedEventSchema = Type.Object(
  {
    sessionId: Type.String(),
    items: Type.Array(TodoItemSchema)
  },
  { additionalProperties: false }
);
export const TodosUpdatedEventValidator = Compile(TodosUpdatedEventSchema);
