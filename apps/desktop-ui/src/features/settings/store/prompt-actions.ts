import type { UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';

import { getDesktopApi } from '@/utils/desktop-api';

import type { SettingsStoreContext } from './types';

export const promptSettingsActions = {
  async loadPromptSettings(this: SettingsStoreContext) {
    this.isPromptLoading = true;

    try {
      const state = await this.runAction('读取 Prompt 设置失败', () => getDesktopApi().promptSettings.getState());
      if (state) {
        this.promptSettings = state;
      }
    } finally {
      this.isPromptLoading = false;
    }
  },

  async updatePromptSettings(this: SettingsStoreContext, payload: UpdatePromptSettingsPayload) {
    this.isPromptLoading = true;

    try {
      const state = await this.runAction('保存 Prompt 设置失败', () => getDesktopApi().promptSettings.update(payload));
      if (!state) {
        return false;
      }

      this.promptSettings = state;
      return true;
    } finally {
      this.isPromptLoading = false;
    }
  }
};
