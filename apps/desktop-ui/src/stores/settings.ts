import { defineStore } from 'pinia';

import { settingsActionRunner } from './settings/action-runner';
import { modelSettingsActions } from './settings/model-actions';
import { settingsPanelActions } from './settings/panel-actions';
import { promptSettingsActions } from './settings/prompt-actions';
import { workspaceSettingsActions } from './settings/workspace-actions';
import type { SettingsSection, SettingsStoreState } from './settings/types';

export type { SettingsSection } from './settings/types';

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
