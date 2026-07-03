import { defineStore } from 'pinia';

export type ToastKind = 'error' | 'success' | 'info';

export type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
};

let nextToastId = 1;

/** 全局轻量通知（Reka Toast 渲染），错误统一走这里而不是页面内联提示。 */
export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [] as ToastItem[]
  }),
  actions: {
    push(kind: ToastKind, title: string, description?: string) {
      this.items.push({ id: nextToastId++, kind, title, description });

      // 防止长时间堆积
      if (this.items.length > 5) {
        this.items.shift();
      }
    },

    dismiss(id: number) {
      this.items = this.items.filter(item => item.id !== id);
    },

    error(title: string, description?: string) {
      this.push('error', title, description);
    },

    success(title: string, description?: string) {
      this.push('success', title, description);
    }
  }
});
