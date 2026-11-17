import { defineAsyncComponent } from 'vue';

export { default as ActivityBar } from './ActivityBar.vue';
export { default as StatusBar } from './StatusBar.vue';
export { default as TitleBar } from './TitleBar.vue';
export { default as TextContextMenu } from './TextContextMenu.vue';
export const SettingsPanel = defineAsyncComponent(() => import('./SettingsPanel.vue'));
