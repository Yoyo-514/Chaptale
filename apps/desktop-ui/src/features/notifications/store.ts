import { defineStore } from 'pinia';

export type NotificationKind = 'error' | 'success' | 'info';
export type NotificationPanelMode = 'auto' | 'manual';

export type NotificationItem = {
  id: number;
  kind: NotificationKind;
  title: string;
  description?: string;
  createdAt: number;
  inProgress?: boolean;
  seen?: boolean;
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
    panelMode: 'auto' as NotificationPanelMode
  }),
  getters: {
    unreadCount: state => state.items.length,
    canClear: state => state.items.some(item => !item.inProgress),
    unseenCount: state => state.items.filter(item => !item.seen).length,
    /** 自动预览只展示最近的未读通知。 */
    recentUnseenItems: state =>
      state.items
        .filter(item => !item.seen)
        .toReversed()
        .slice(0, 3),
    allItems: state => state.items.toReversed()
  },
  actions: {
    push(kind: NotificationKind, title: string, description?: string, inProgress?: boolean) {
      const id = nextNotificationId++;
      this.items.push({ id, kind, title, description, createdAt: Date.now(), inProgress });
      this.trimHistory();
      this.preview();
      return id;
    },

    preview() {
      this.panelMode = 'auto';
      this.isPanelOpen = true;
      this.schedulePanelAutoHide();
    },

    trimHistory() {
      // 归档保留最近 30 条；正在运行的任务要留到结束。
      const completed = this.items.filter(item => !item.inProgress);
      if (completed.length <= 30) return;
      const keep = new Set(completed.slice(-30).map(item => item.id));
      this.items = this.items.filter(item => item.inProgress || keep.has(item.id));
    },

    startProgress(title: string, description: string) {
      return this.push('info', title, description, true);
    },

    updateProgress(id: number, description: string) {
      this.items.find(item => item.id === id)!.description = description;
    },

    finishProgress(id: number, kind: NotificationKind, title: string, description: string) {
      const current = this.items.find(item => item.id === id)!;
      const viewing = this.isPanelOpen && this.panelMode === 'manual';
      Object.assign(current, { kind, title, description, inProgress: false, seen: viewing });
      if (!viewing) {
        // 同一条通知进入最新预览，完成结果算作未读。
        this.items = [...this.items.filter(item => item.id !== id), current];
        this.preview();
      }
      this.trimHistory();
    },

    dismiss(id: number) {
      this.items = this.items.filter(item => item.id !== id || item.inProgress);
    },

    clear() {
      this.items = this.items.filter(item => item.inProgress);
      this.closePanel();
    },

    openPanel() {
      clearPanelAutoHideTimer();
      this.panelMode = 'manual';
      this.isPanelOpen = true;
      this.markAllSeen();
    },

    markAllSeen() {
      for (const item of this.items) item.seen = true;
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
