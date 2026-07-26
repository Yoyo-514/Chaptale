import { Type, type Static } from 'typebox';

import { TodoItemSchema, type TodoItem } from '@chaptale/shared';

import type { ToolDefinition } from '../../core/tool-protocol/definition';
import type { TodoStore } from './store';

const todoWriteParameters = Type.Object(
  {
    /** write：整表替换；update：按 id 增量更新（可并行）；clear：清空清单。 */
    action: Type.Union([Type.Literal('write'), Type.Literal('update'), Type.Literal('clear')]),
    items: Type.Optional(Type.Array(TodoItemSchema))
  },
  { additionalProperties: false }
);

export type TodoWriteToolOptions = {
  todoStore: TodoStore;
  /** 返回当前会话 id；会话尚未就绪时返回 null，此时工具报错而非写入错误位置。 */
  getSessionId: () => string | null;
};

/**
 * todo_write：维护当前会话的任务清单（参考 Claude Code TodoWrite，扩展增量与清空动作）。
 *
 * 语义规则在此强制（id 唯一、至多一项 in_progress），存储层只管原子读写。
 */
export function createTodoWriteTool(options: TodoWriteToolOptions): ToolDefinition<typeof todoWriteParameters> {
  return {
    name: 'todo_write',
    riskLevel: 'readonly',
    label: '任务清单',
    description:
      '维护当前会话的任务清单。action=write 整表替换（规划新任务时用）；' +
      'action=update 按 id 增量更新或追加个别项（推进进度时用，可并行调用）；' +
      'action=clear 清空清单（计划完成或作废时用）。' +
      '同一时刻至多一项 in_progress。',
    parameters: todoWriteParameters,
    async execute(params) {
      const sessionId = options.getSessionId();

      if (!sessionId) {
        throw new Error('当前会话尚未就绪，无法写入任务清单');
      }

      const next = await options.todoStore.mutate(sessionId, current => applyAction(current, params));

      if (next.length === 0) {
        return { text: '任务清单已清空', details: { items: next } };
      }

      const completed = next.filter(item => item.status === 'completed').length;
      const current = next.find(item => item.status === 'in_progress');

      return {
        text: [
          `任务清单已更新：${completed}/${next.length} 完成`,
          ...(current ? [`当前进行中：${current.activeForm ?? current.content}`] : [])
        ].join('，'),
        details: { items: next }
      };
    }
  };
}

/** 按 action 计算新表；校验失败抛错（错误信息直接反馈给模型自我修正）。 */
function applyAction(current: TodoItem[], params: Static<typeof todoWriteParameters>): TodoItem[] {
  if (params.action === 'clear') {
    return [];
  }

  if (!params.items?.length) {
    throw new Error(`action=${params.action} 需要非空 items；清空请用 action=clear`);
  }

  const next = params.action === 'write' ? params.items : upsertById(current, params.items);
  assertListInvariants(next);
  return next;
}

/** 按 id 合并：已存在则整项替换，不存在则追加到表尾（保持原有顺序稳定）。 */
function upsertById(current: TodoItem[], patches: TodoItem[]): TodoItem[] {
  const merged = [...current];

  for (const patch of patches) {
    const index = merged.findIndex(item => item.id === patch.id);

    if (index === -1) {
      merged.push(patch);
    } else {
      merged[index] = patch;
    }
  }

  return merged;
}

/** 清单不变量：id 唯一；至多一项 in_progress。 */
function assertListInvariants(items: TodoItem[]): void {
  const ids = new Set<string>();

  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`todo id 重复：${item.id}；每项需要清单内唯一且稳定的 id`);
    }

    ids.add(item.id);
  }

  const inProgress = items.filter(item => item.status === 'in_progress');

  if (inProgress.length > 1) {
    throw new Error(
      `同一时刻至多一项 in_progress，当前有 ${inProgress.length} 项（${inProgress.map(item => item.id).join('、')}）；` +
        '请先把已完成的标记为 completed'
    );
  }
}
