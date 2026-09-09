import { defineAsyncComponent } from 'vue';

export const ContentSettings = defineAsyncComponent(() => import('./ContentSettings.vue'));
export { contentKey, toContentRef, useContentStore } from './store';
