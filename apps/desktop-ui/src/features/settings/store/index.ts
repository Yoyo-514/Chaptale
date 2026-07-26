import { defineStore } from 'pinia';

import { settingsActionRunner } from './action-runner';
import { modelSettingsActions } from './model-actions';
import { settingsPanelActions } from './panel-actions';
import { promptSettingsActions } from './prompt-actions';
import type { SettingsSection, SettingsStoreState } from './types';
import { workspaceSettingsActions } from './workspace-actions';

export type { SettingsSection } from './types';

/**
 * 设置面板的统一状态入口。
 * 按 workspace、prompt、model 与 panel 拆分 action 文件，store 仅组合共享状态，避免各设置区维护互相失真的副本。
 */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsStoreState => ({
    state: undefined,
    models: undefined,
    promptSettings: undefined,
    activeSection: 'workspace' as SettingsSection,
    isOpen: false,
    isLoading: false,
    isPromptLoading: false,
    isModelsLoading: false,
    isFetchingCustomModels: false,
    fetchedCustomModels: [],
    error: ''
  }),
  actions: {
    ...settingsActionRunner,
    ...settingsPanelActions,
    ...promptSettingsActions,
    ...workspaceSettingsActions,
    ...modelSettingsActions
  }
});
