export { useWorkspaceStore } from './store';
export { useFileTreeStore } from './file-tree/store';
export { default as WorkspaceExplorer } from './components/WorkspaceExplorer.vue';
export { default as NewWorkspaceDialog } from './components/NewWorkspaceDialog.vue';
export { default as WorkspaceActionDialogs } from './components/WorkspaceActionDialogs.vue';
export { useWorkspaceActions } from './actions';
export { localSyncSummary } from './sync-status';
export const WorkspaceSyncDialog = defineAsyncComponent(() => import('./components/WorkspaceSyncDialog.vue'));
import { defineAsyncComponent } from 'vue';
