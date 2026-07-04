import { defineStore } from 'pinia';

import { settingsActionRunner } from './settings/action-runner';
import { modelSettingsActions } from './settings/model-actions';
import { settingsPanelActions } from './settings/panel-actions';
import { workspaceSettingsActions } from './settings/workspace-actions';
import type { SettingsSection, SettingsStoreState } from './settings/types';

export type { SettingsSection } from './settings/types';

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsStoreState => ({
    state: undefined,
    models: undefined,
    activeSection: 'workspace' as SettingsSection,
    isOpen: false,
    isLoading: false,
    isModelsLoading: false,
    isFetchingCustomModels: false,
    fetchedCustomModels: [],
    error: ''
  }),
  actions: {
    ...settingsActionRunner,
    ...settingsPanelActions,
    ...workspaceSettingsActions,
    ...modelSettingsActions
  }
});
