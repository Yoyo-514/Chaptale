import { toErrorMessage } from '../utils/desktop-api';
import { useNotificationStore } from '../notification';
import type { SettingsStoreState } from './types';

export const settingsActionRunner = {
  /**
   * 统一的动作执行辅助：清空错误、捕获异常并发通知。
   * 返回 undefined 表示失败（错误已提示给用户）。
   */
  async runAction<T>(this: SettingsStoreState, title: string, action: () => Promise<T>): Promise<T | undefined> {
    this.error = '';

    try {
      return await action();
    } catch (error) {
      this.error = toErrorMessage(error);
      useNotificationStore().error(title, this.error);
      return undefined;
    }
  }
};
