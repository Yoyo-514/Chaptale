import type { Static } from 'typebox';

import type { TodoItem } from '@chaptale/shared';

import type { TodosClearPayloadSchema } from './schemas/todos';

/** todo 清单变更事件：整表推送，与存储的整表替换语义一致。 */
export type TodosUpdatedEvent = {
  sessionId: string;
  items: TodoItem[];
};

/** 用户手动清理 todo 清单的请求；scope 决定清理范围。 */
export type TodosClearPayload = Static<typeof TodosClearPayloadSchema>;
