import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '../store';

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
    expect(store.unseenCount).toBe(30);
    expect(store.recentUnseenItems.map(item => item.title)).toEqual(['消息 32', '消息 31', '消息 30']);
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

  it('counts only notifications newer than the last manual open as unseen', () => {
    const store = useNotificationStore();

    store.info('自动弹出的通知');
    // push 会自动弹出面板，但未经用户点开，仍算新通知。
    expect(store.unseenCount).toBe(1);

    store.openPanel();
    expect(store.unseenCount).toBe(0);
    expect(store.unreadCount).toBe(1);

    store.info('看过之后的新通知');
    expect(store.unseenCount).toBe(1);

    store.togglePanel();
    expect(store.unseenCount).toBe(0);
  });

  it('excludes seen notifications from the auto popup list', () => {
    const store = useNotificationStore();

    store.info('旧通知 1');
    store.info('旧通知 2');
    store.openPanel();

    // 看过之后新消息自动弹出，只应包含未看过的那一条。
    store.success('新通知');
    expect(store.panelMode).toBe('auto');
    expect(store.recentUnseenItems.map(item => item.title)).toEqual(['新通知']);
    expect(store.allItems).toHaveLength(3);
  });
});
