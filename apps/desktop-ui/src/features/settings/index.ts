import { defineAsyncComponent } from 'vue';

export const SettingsPanel = defineAsyncComponent(() => import('./SettingsPanel.vue'));
export { default as SettingsSectionView } from './components/SettingsSection.vue';
export { useSettingsStore } from './store';
export type { SettingsSection } from './store/types';
export { applyTheme, readCachedTheme } from './theme';
