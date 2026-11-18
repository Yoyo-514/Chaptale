import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebarOpen = ref(true);
  const auxiliaryOpen = ref(false);
  /** 会话视图里的子页；历史和会话设置都带「返回会话」。 */
  const agentView = ref<'chat' | 'history' | 'settings'>('chat');
  const statusBarOpen = ref(true);
  const focusMode = ref(false);
  function toggleSidebar() {
    sidebarOpen.value = focusMode.value || !sidebarOpen.value;
    focusMode.value = false;
  }
  /** 在协作栏打开会话视图。 */
  function showAgent() {
    agentView.value = 'chat';
    auxiliaryOpen.value = true;
    focusMode.value = false;
  }
  function toggleAuxiliary() {
    if (auxiliaryOpen.value && !focusMode.value) auxiliaryOpen.value = false;
    else showAgent();
  }
  return {
    sidebarOpen,
    auxiliaryOpen,
    agentView,
    statusBarOpen,
    focusMode,
    toggleSidebar,
    showAgent,
    toggleAuxiliary
  };
});
