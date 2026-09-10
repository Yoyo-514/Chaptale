import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import { useTodoProgress } from '../composables/useTodoProgress';

describe('useTodoProgress', () => {
  beforeEach(() => {
    delete window.chaptaleDesktop;
  });

  it('returns an empty hidden progress model without the desktop bridge', () => {
    let model!: ReturnType<typeof useTodoProgress>;

    const wrapper = mount(
      defineComponent({
        setup() {
          model = useTodoProgress(() => 'session-1');
          return () => null;
        }
      })
    );

    expect(model.items.value).toEqual([]);
    expect(model.total.value).toBe(0);
    expect(model.completedCount.value).toBe(0);
    expect(model.visible.value).toBe(false);
    expect(model.isClearing.value).toBe(false);

    wrapper.unmount();
  });

  it('clears all or completed through the desktop bridge and refreshes items', async () => {
    const clear = vi.fn();
    clear.mockResolvedValueOnce([{ id: '2', content: '进行中', status: 'in_progress' as const }]);
    clear.mockResolvedValueOnce([]);
    window.chaptaleDesktop = {
      todos: {
        get: vi.fn().mockResolvedValue([
          { id: '1', content: '已完成', status: 'completed' as const },
          { id: '2', content: '进行中', status: 'in_progress' as const }
        ]),
        clear,
        onUpdated: vi.fn(() => () => undefined)
      }
    } as any;
    let model!: ReturnType<typeof useTodoProgress>;

    const wrapper = mount(
      defineComponent({
        setup() {
          model = useTodoProgress(() => 'session-1');
          return () => null;
        }
      })
    );
    await nextTick();

    expect(await model.clearCompleted()).toBe(true);
    expect(clear).toHaveBeenCalledWith({ sessionId: 'session-1', scope: 'completed' });
    expect(model.items.value.map(item => item.id)).toEqual(['2']);

    expect(await model.clearAll()).toBe(true);
    expect(clear).toHaveBeenCalledWith({ sessionId: 'session-1', scope: 'all' });
    expect(model.items.value).toEqual([]);
    expect(model.visible.value).toBe(false);
    expect(model.isClearing.value).toBe(false);

    wrapper.unmount();
  });

  it('rejects clearing without a session and survives IPC failures', async () => {
    const api = {
      todos: {
        get: vi.fn().mockResolvedValue([]),
        clear: vi.fn().mockRejectedValue(new Error('boom')),
        onUpdated: vi.fn(() => () => undefined)
      }
    } as any;
    window.chaptaleDesktop = api;
    let sessionId = '';
    let model!: ReturnType<typeof useTodoProgress>;

    const wrapper = mount(
      defineComponent({
        setup() {
          model = useTodoProgress(() => sessionId);
          return () => null;
        }
      })
    );
    await nextTick();

    // 无会话时直接拒绝，不发起 IPC。
    expect(await model.clearAll()).toBe(false);
    expect(api.todos.clear).not.toHaveBeenCalled();

    // IPC 失败时保持失败态并复位清理中标记。
    sessionId = 'session-1';
    expect(await model.clearCompleted()).toBe(false);
    expect(model.isClearing.value).toBe(false);

    wrapper.unmount();
  });
});
