import { defineAsyncComponent } from 'vue';

export const ContentSettings = defineAsyncComponent(() => import('./ContentSettings.vue'));
export { useContentStore } from './store';
