import { Type } from 'typebox';

import { TodoItemSchema } from '@chaptale/shared';

import type { ToolDefinition } from '../tools/definition';
import type { TodoStore } from './store';

const todoWriteParameters = Type.Object(
  {
    items: Type.Array(TodoItemSchema)
  },
  { additionalProperties: false }
);

export type TodoWriteToolOptions = {
  todoStore: TodoStore;
  /** 返回当前会话 id；会话尚未就绪时返回 null，此时工具报错而非写入错误位置。 */
  getSessionId: () => string | null;
};

/** todo_write：整表替换当前会话的任务清单（参考 Claude Code TodoWrite 的最简形态）。 */
export function createTodoWriteTool(options: TodoWriteToolOptions): ToolDefinition<typeof todoWriteParameters> {
  return {
    name: 'todo_write',
    label: '任务清单',
    description:
      '维护当前会话的任务清单（整表替换：传入的 items 会完全覆盖旧清单）。' +
      '多步任务先写出完整清单，每完成一项立即更新状态。',
    parameters: todoWriteParameters,
    async execute(params) {
      const sessionId = options.getSessionId();

      if (!sessionId) {
        throw new Error('当前会话尚未就绪，无法写入任务清单');
      }

      await options.todoStore.replace(sessionId, params.items);

      const total = params.items.length;
      const completed = params.items.filter(item => item.status === 'completed').length;
      const current = params.items.find(item => item.status === 'in_progress');

      return {
        text: [
          `任务清单已更新：${completed}/${total} 完成`,
          ...(current ? [`当前进行中：${current.content}`] : [])
        ].join('，'),
        details: { items: params.items }
      };
    }
  };
}
