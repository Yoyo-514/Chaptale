import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { WorkspaceView } from './views';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebar = ref<'workspace' | 'structure' | 'review' | 'memory' | 'search'>('workspace');
  const auxiliary = ref<'agent' | 'references' | 'candidates' | 'review' | 'settlement' | 'assets' | 'runs'>('agent');
  const sidebarOpen = ref(true);
  const auxiliaryOpen = ref(true);
  const statusBarOpen = ref(true);
  const focusMode = ref(false);
  const center = ref<'editor' | WorkspaceView>('editor');
  const viewTabs = ref<WorkspaceView[]>([]);
  const agentBusy = ref(false);
  const agentCancelling = ref(false);
  const cancelAgentRequest = ref(0);
  const agentRequests = ref<Array<{ id: number; rootPath: string; prompt: string; files: string[] }>>([]);
  let requestId = 0;
  function openView(view: WorkspaceView) {
    if (!viewTabs.value.includes(view)) viewTabs.value.push(view);
    center.value = view;
  }
  function closeView(view: WorkspaceView) {
    viewTabs.value = viewTabs.value.filter(item => item !== view);
    if (center.value === view) center.value = 'editor';
  }
  function resetViews() {
    viewTabs.value = [];
    center.value = 'editor';
  }
  function focusEditor() {
    center.value = 'editor';
  }
  function toggleSidebar(view = sidebar.value) {
    sidebarOpen.value = sidebar.value === view && !focusMode.value ? !sidebarOpen.value : true;
    sidebar.value = view;
    focusMode.value = false;
  }
  function showSidebar(view: typeof sidebar.value) {
    sidebar.value = view;
    sidebarOpen.value = true;
    focusMode.value = false;
  }
  function showAuxiliary(view: typeof auxiliary.value) {
    auxiliary.value = view;
    auxiliaryOpen.value = true;
    focusMode.value = false;
  }
  function toggleAuxiliary() {
    if (auxiliaryOpen.value && !focusMode.value) {
      auxiliaryOpen.value = false;
    } else showAuxiliary(auxiliary.value);
  }
  function askAgent(rootPath: string, prompt: string, files: string[] = []) {
    agentRequests.value.push({ id: ++requestId, rootPath, prompt, files });
    showAuxiliary('agent');
  }
  return {
    sidebar,
    auxiliary,
    sidebarOpen,
    auxiliaryOpen,
    statusBarOpen,
    focusMode,
    focusEditor,
    center,
    viewTabs,
    openView,
    closeView,
    resetViews,
    agentBusy,
    agentCancelling,
    cancelAgentRequest,
    toggleSidebar,
    showSidebar,
    showAuxiliary,
    toggleAuxiliary,
    agentRequests,
    askAgent
  };
});
