import { defineStore } from 'pinia';

import type { DataDirectoryStatus } from '@chaptale/desktop/bridge';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 作品与会话历史所在的数据目录；就绪之前界面不连接应用宿主。 */
export const useDataDirectoryStore = defineStore('data-directory', {
  state: () => ({
    status: undefined as DataDirectoryStatus | undefined,
    busy: false,
    error: ''
  }),
  getters: {
    ready: state => state.status?.kind === 'ready'
  },
  actions: {
    async run(action: () => Promise<DataDirectoryStatus | undefined>) {
      this.busy = true;
      this.error = '';
      try {
        const status = await action();
        if (status) this.status = status;
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.busy = false;
      }
    },

    load() {
      return this.run(() => getDesktopApi().dataDirectory.status());
    },

    /** 打开系统文件夹选择框；取消时返回 null。 */
    async pick(): Promise<string | null> {
      this.error = '';
      return getDesktopApi().dataDirectory.select();
    },

    choose(path: string) {
      return this.run(() => getDesktopApi().dataDirectory.choose(path));
    },

    /** 选择文件夹后立即保存；用于更改位置与目录不可用时另选。 */
    async pickAndChoose() {
      const path = await this.pick();
      if (path) await this.choose(path);
    }
  }
});
