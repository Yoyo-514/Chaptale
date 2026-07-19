import type { UpdateChaptaleSettingsPayload, UpdatePiWebAccessSettingsPayload } from '@chaptale/ipc-contract';

import { getDesktopApi } from '../utils/desktop-api';
import type { SettingsStoreContext } from './types';

/** 应用设置与 Web Access 的读写动作；每次成功响应都整体替换状态快照。 */
export const workspaceSettingsActions = {
  async load(this: SettingsStoreContext) {
    this.isLoading = true;

    try {
      const state = await this.runAction('读取设置失败', () => getDesktopApi().settings.getState());
      if (state) {
        this.state = state;
      }
    } finally {
      this.isLoading = false;
    }
  },

  async update(this: SettingsStoreContext, payload: UpdateChaptaleSettingsPayload) {
    this.isLoading = true;

    try {
      const state = await this.runAction('更新设置失败', () => getDesktopApi().settings.update(payload));
      if (state) {
        this.state = state;
      }
    } finally {
      this.isLoading = false;
    }
  },

  async updateWebAccess(this: SettingsStoreContext, payload: UpdatePiWebAccessSettingsPayload) {
    this.isLoading = true;

    try {
      const state = await this.runAction('更新联网设置失败', () => getDesktopApi().settings.updateWebAccess(payload));
      if (state) {
        this.state = state;
      }
    } finally {
      this.isLoading = false;
    }
  },

  async selectWorkspaceDir(this: SettingsStoreContext) {
    this.isLoading = true;

    try {
      const result = await this.runAction('选择工作区失败', () => getDesktopApi().settings.selectWorkspaceDir());
      if (result && !result.canceled && result.state) {
        this.state = result.state;
      }
    } finally {
      this.isLoading = false;
    }
  },

  async useGlobalStorage(this: SettingsStoreContext) {
    await this.update({ storage: { mode: 'global' } });
  },

  async openConfigDir(this: SettingsStoreContext) {
    await this.runAction('打开配置目录失败', () => getDesktopApi().settings.openConfigDir());
  }
};
