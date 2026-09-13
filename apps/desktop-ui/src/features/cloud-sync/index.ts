import { defineAsyncComponent } from 'vue';

export const CloudSyncSettings = defineAsyncComponent(() => import('./CloudSyncSettings.vue'));
export { formatSize, formatWhen, useCloudSyncStore } from './store';
