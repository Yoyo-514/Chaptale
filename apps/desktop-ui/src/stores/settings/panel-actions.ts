import type { SettingsSection, SettingsStoreContext } from './types';

export const settingsPanelActions = {
  openPanel(this: SettingsStoreContext, section?: SettingsSection) {
    this.isOpen = true;

    if (section) {
      this.activeSection = section;
    }

    void this.load();
    void this.loadModels();
  },

  closePanel(this: SettingsStoreContext) {
    this.isOpen = false;
  },

  setSection(this: SettingsStoreContext, section: SettingsSection) {
    this.activeSection = section;

    if (section === 'llm' && !this.models) {
      void this.loadModels();
    }
  }
};
