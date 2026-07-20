import { describe, expect, it, vi } from 'vitest';

import { createTodoWriteTool } from '../tool';

const items = [
  { id: '1', content: '写大纲', status: 'completed' as const },
  { id: '2', content: '写第一章', status: 'in_progress' as const }
];

describe('todo_write tool', () => {
  it('replaces the session list and reports progress in the result text', async () => {
    const todoStore = { replace: vi.fn(async () => undefined) };
    const tool = createTodoWriteTool({ todoStore: todoStore as never, getSessionId: () => 's1' });

    const result = await tool.execute({ items });

    expect(todoStore.replace).toHaveBeenCalledWith('s1', items);
    expect(result.text).toContain('1/2 完成');
    expect(result.text).toContain('写第一章');
    expect(result.details).toEqual({ items });
  });

  it('rejects execution when the session is not ready', async () => {
    const todoStore = { replace: vi.fn(async () => undefined) };
    const tool = createTodoWriteTool({ todoStore: todoStore as never, getSessionId: () => null });

    await expect(tool.execute({ items })).rejects.toThrow(/尚未就绪/);
    expect(todoStore.replace).not.toHaveBeenCalled();
  });
});
