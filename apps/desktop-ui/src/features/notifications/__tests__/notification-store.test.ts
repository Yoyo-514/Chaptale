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

  it('更新同一条进度通知，清除历史后仍可打开查看，完成后成为结果', () => {
    const store = useNotificationStore();
    store.info('旧通知');
    const id = store.startProgress('《雨夜》云备份', '正在生成作品包…');
    vi.advanceTimersByTime(5000);
    expect(store.isPanelOpen).toBe(false);

    store.clear();
    store.updateProgress(id, '正在上传到 Dropbox（1/2）');
    expect(store.isPanelOpen).toBe(false);
    store.openPanel();
    expect(store.allItems).toMatchObject([{ id, description: '正在上传到 Dropbox（1/2）', inProgress: true }]);

    store.finishProgress(id, 'success', '《雨夜》已备份到云端', 'Dropbox：已备份');
    expect(store.allItems).toMatchObject([{ id, title: '《雨夜》已备份到云端', kind: 'success', inProgress: false }]);
    vi.advanceTimersByTime(5000);
    expect(store.isPanelOpen).toBe(true);
    expect(store.panelMode).toBe('manual');
  });

  it('即使进度已看过，结束后也重新弹出结果，历史仍只留一条', () => {
    const store = useNotificationStore();
    const id = store.startProgress('《雨夜》云备份', '正在上传到 Dropbox');
    store.openPanel();
    store.closePanel();
    expect(store.unseenCount).toBe(0);

    store.finishProgress(id, 'error', '《雨夜》已备份到部分网盘', 'OneDrive：空间不足');

    expect(store.isPanelOpen).toBe(true);
    expect(store.panelMode).toBe('auto');
    expect(store.recentUnseenItems).toMatchObject([{ id, title: '《雨夜》已备份到部分网盘', inProgress: false }]);
    expect(store.allItems).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(store.isPanelOpen).toBe(false);
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
