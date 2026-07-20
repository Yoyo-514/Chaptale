import type { TodoItem } from '@chaptale/shared';

/** todo 清单变更事件：整表推送，与存储的整表替换语义一致。 */
export type TodosUpdatedEvent = {
  sessionId: string;
  items: TodoItem[];
};
