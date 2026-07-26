import { defineStore } from 'pinia';

export type NotificationKind = 'error' | 'success' | 'info';
export type NotificationPanelMode = 'auto' | 'manual';

export type NotificationItem = {
  id: number;
  kind: NotificationKind;
  title: string;
  description?: string;
  createdAt: number;
};

let nextNotificationId = 1;
let panelAutoHideTimer: number | undefined;

const PANEL_AUTO_HIDE_DELAY_MS = 5000;

function clearPanelAutoHideTimer() {
  if (panelAutoHideTimer === undefined || typeof window === 'undefined') {
    panelAutoHideTimer = undefined;
    return;
  }

  window.clearTimeout(panelAutoHideTimer);
  panelAutoHideTimer = undefined;
}

/** 全局通知中心：状态栏只作为入口，通知面板独立渲染。 */
export const useNotificationStore = defineStore('notification', {
  state: () => ({
    items: [] as NotificationItem[],
    isPanelOpen: false,
    panelMode: 'auto' as NotificationPanelMode,
    // 用户最后一次“点开看过”时的最大通知 id，之后的才算新通知。
    seenThroughId: 0
  }),
  getters: {
    unreadCount: state => state.items.length,
    unseenCount: state => state.items.filter(item => item.id > state.seenThroughId).length,
    /** 自动弹出面板只展示未看过的新通知，看过的不再重复打扰。 */
    recentUnseenItems: state =>
      state.items
        .filter(item => item.id > state.seenThroughId)
        .toReversed()
        .slice(0, 3),
    allItems: state => state.items.toReversed()
  },
  actions: {
    push(kind: NotificationKind, title: string, description?: string) {
      this.items.push({
        id: nextNotificationId++,
        kind,
        title,
        description,
        createdAt: Date.now()
      });

      // 通知中心只保留最近消息，避免长期运行后无限增长。
      if (this.items.length > 30) {
        this.items.splice(0, this.items.length - 30);
      }

      this.panelMode = 'auto';
      this.isPanelOpen = true;
      this.schedulePanelAutoHide();
    },

    dismiss(id: number) {
      this.items = this.items.filter(item => item.id !== id);
    },

    clear() {
      this.items = [];
      this.closePanel();
    },

    openPanel() {
      clearPanelAutoHideTimer();
      this.panelMode = 'manual';
      this.isPanelOpen = true;
      this.markAllSeen();
    },

    markAllSeen() {
      const lastItem = this.items.at(-1);

      if (lastItem) {
        this.seenThroughId = Math.max(this.seenThroughId, lastItem.id);
      }
    },

    closePanel() {
      clearPanelAutoHideTimer();
      this.isPanelOpen = false;
    },

    togglePanel() {
      if (this.isPanelOpen && this.panelMode === 'manual') {
        this.closePanel();
        return;
      }

      this.openPanel();
    },

    schedulePanelAutoHide() {
      clearPanelAutoHideTimer();

      if (typeof window === 'undefined') {
        return;
      }

      panelAutoHideTimer = window.setTimeout(() => {
        this.closePanel();
      }, PANEL_AUTO_HIDE_DELAY_MS);
    },

    error(title: string, description?: string) {
      this.push('error', title, description);
    },

    success(title: string, description?: string) {
      this.push('success', title, description);
    },

    info(title: string, description?: string) {
      this.push('info', title, description);
    }
  }
});
