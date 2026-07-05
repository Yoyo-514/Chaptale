import { defineStore } from 'pinia';

export type NotificationKind = 'error' | 'success' | 'info';

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
    isPanelOpen: false
  }),
  getters: {
    unreadCount: state => state.items.length,
    recentItems: state => [...state.items].reverse().slice(0, 3)
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
      this.isPanelOpen = true;
    },

    closePanel() {
      clearPanelAutoHideTimer();
      this.isPanelOpen = false;
    },

    togglePanel() {
      clearPanelAutoHideTimer();
      this.isPanelOpen = !this.isPanelOpen;
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
