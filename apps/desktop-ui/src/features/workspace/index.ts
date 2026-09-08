export { useWorkspaceStore } from './store';
export { useFileTreeStore } from './file-tree/store';
export type { FileTreeRow, PendingCreation } from './file-tree/store';
export { default as WorkspaceExplorer } from './components/WorkspaceExplorer.vue';
export { default as NewWorkspaceDialog } from './components/NewWorkspaceDialog.vue';
export { default as WorkspaceActionDialogs } from './components/WorkspaceActionDialogs.vue';
export { useWorkspaceActions } from './actions';
