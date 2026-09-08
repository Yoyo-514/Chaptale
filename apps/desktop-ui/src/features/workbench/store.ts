import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebar = ref<'workspace' | 'structure' | 'review' | 'memory' | 'search'>('workspace');
  const auxiliary = ref<'agent' | 'references' | 'candidates' | 'review' | 'settlement' | 'assets' | 'runs'>('agent');
  const sidebarOpen = ref(true);
  const auxiliaryOpen = ref(true);
  const statusBarOpen = ref(true);
  const focusMode = ref(false);
  const center = ref<'editor' | 'library' | 'timeline' | 'relationships'>('editor');
  const agentBusy = ref(false);
  const agentCancelling = ref(false);
  const cancelAgentRequest = ref(0);
  const agentRequests = ref<Array<{ id: number; rootPath: string; prompt: string; files: string[] }>>([]);
  let requestId = 0;
  function toggleSidebar(view = sidebar.value) {
    sidebarOpen.value = sidebar.value === view ? !sidebarOpen.value : true;
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
  function toggleAgent() {
    if (auxiliary.value === 'agent' && auxiliaryOpen.value && !focusMode.value) auxiliaryOpen.value = false;
    else showAuxiliary('agent');
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
    center,
    agentBusy,
    agentCancelling,
    cancelAgentRequest,
    toggleSidebar,
    showSidebar,
    showAuxiliary,
    toggleAgent,
    agentRequests,
    askAgent
  };
});
