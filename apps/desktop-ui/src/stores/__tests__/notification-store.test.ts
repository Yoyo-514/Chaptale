import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '../notification';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

describe('notification store', () => {
  it('pushes notifications, keeps only recent items, and exposes unread/recent getters', () => {
    const store = useNotificationStore();

    for (let index = 1; index <= 32; index += 1) {
      store.info(`消息 ${index}`);
    }

    expect(store.items).toHaveLength(30);
    expect(store.items[0]?.title).toBe('消息 3');
    expect(store.unreadCount).toBe(30);
    expect(store.recentItems.map(item => item.title)).toEqual(['消息 32', '消息 31', '消息 30']);
    expect(store.allItems.map(item => item.title).slice(0, 4)).toEqual(['消息 32', '消息 31', '消息 30', '消息 29']);
    expect(store.isPanelOpen).toBe(true);
    expect(store.panelMode).toBe('auto');
  });

  it('dismisses, clears, opens, closes, toggles, and auto-hides the panel', () => {
    const store = useNotificationStore();

    store.error('错误', '详情');
    const id = store.items[0]!.id;
    store.dismiss(id);
    expect(store.items).toEqual([]);

    store.success('成功');
    store.closePanel();
    expect(store.isPanelOpen).toBe(false);

    store.openPanel();
    expect(store.isPanelOpen).toBe(true);
    expect(store.panelMode).toBe('manual');

    store.togglePanel();
    expect(store.isPanelOpen).toBe(false);
    store.togglePanel();
    expect(store.isPanelOpen).toBe(true);
    expect(store.panelMode).toBe('manual');

    store.schedulePanelAutoHide();
    vi.advanceTimersByTime(5000);
    expect(store.isPanelOpen).toBe(false);

    store.clear();
    expect(store.items).toEqual([]);
  });
});
