import { describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '@chaptale/shared';

import { createTodoWriteTool } from '../tool';

const baseItems: TodoItem[] = [
  { id: '1', content: '写大纲', activeForm: '正在写大纲', status: 'completed' },
  { id: '2', content: '写第一章', activeForm: '正在写第一章', status: 'in_progress' }
];

/** mutate 桩：对给定现表执行 mutator，模拟存储层的原子读改写。 */
function createTool(current: TodoItem[] = baseItems, sessionId: string | null = 's1') {
  const todoStore = {
    mutate: vi.fn(async (_sessionId: string, mutator: (items: TodoItem[]) => TodoItem[]) => mutator(current))
  };
  const tool = createTodoWriteTool({ todoStore: todoStore as never, getSessionId: () => sessionId });
  return { tool, todoStore };
}

describe('todo_write tool', () => {
  it('write replaces the whole list and reports progress with the active form', async () => {
    const { tool, todoStore } = createTool();

    const result = await tool.execute({ action: 'write', items: baseItems });

    expect(todoStore.mutate).toHaveBeenCalledWith('s1', expect.any(Function));
    expect(result.text).toContain('1/2 完成');
    expect(result.text).toContain('正在写第一章');
    expect(result.details).toEqual({ items: baseItems });
  });

  it('update upserts by id and keeps untouched items in place', async () => {
    const { tool } = createTool();

    const result = await tool.execute({
      action: 'update',
      items: [
        { id: '2', content: '写第一章', status: 'completed' },
        { id: '3', content: '写第二章', status: 'in_progress' }
      ]
    });

    expect(result.details).toEqual({
      items: [
        { id: '1', content: '写大纲', activeForm: '正在写大纲', status: 'completed' },
        { id: '2', content: '写第一章', status: 'completed' },
        { id: '3', content: '写第二章', status: 'in_progress' }
      ]
    });
  });

  it('clear empties the list without requiring items', async () => {
    const { tool } = createTool();

    const result = await tool.execute({ action: 'clear' });

    expect(result.text).toBe('任务清单已清空');
    expect(result.details).toEqual({ items: [] });
  });

  it('rejects write and update without items', async () => {
    const { tool } = createTool();

    await expect(tool.execute({ action: 'write' })).rejects.toThrow(/需要非空 items/);
    await expect(tool.execute({ action: 'update', items: [] })).rejects.toThrow(/需要非空 items/);
  });

  it('rejects duplicate ids', async () => {
    const { tool } = createTool();

    await expect(
      tool.execute({
        action: 'write',
        items: [
          { id: 'x', content: 'A', status: 'pending' },
          { id: 'x', content: 'B', status: 'pending' }
        ]
      })
    ).rejects.toThrow(/todo id 重复/);
  });

  it('rejects more than one in_progress item, including after a merge', async () => {
    const { tool } = createTool();

    // 现表已有 id=2 in_progress，追加另一个 in_progress 项会违反不变量。
    await expect(
      tool.execute({ action: 'update', items: [{ id: '3', content: '写第二章', status: 'in_progress' }] })
    ).rejects.toThrow(/至多一项 in_progress/);
  });

  it('rejects execution when the session is not ready', async () => {
    const { tool, todoStore } = createTool(baseItems, null);

    await expect(tool.execute({ action: 'clear' })).rejects.toThrow(/尚未就绪/);
    expect(todoStore.mutate).not.toHaveBeenCalled();
  });
});
