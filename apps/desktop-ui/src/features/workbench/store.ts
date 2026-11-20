import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebarOpen = ref(true);
  const auxiliaryOpen = ref(false);
  /** 会话视图里的子页；历史和会话设置都带「返回会话」。 */
  const agentView = ref<'chat' | 'history' | 'settings'>('chat');
  const statusBarOpen = ref(true);
  const focusMode = ref(false);
  const sidebarView = ref<'explorer' | 'search'>('explorer');
  const searchFocus = ref(0);
  /** 搜索面板的替换行是否展开。 */
  const searchReplace = ref(false);
  function openSearch(replace = false) {
    if (replace) searchReplace.value = true;
    sidebarView.value = 'search';
    sidebarOpen.value = true;
    focusMode.value = false;
    searchFocus.value++;
  }
  function toggleSidebar(view: 'explorer' | 'search' = 'explorer') {
    if (view !== sidebarView.value) sidebarOpen.value = false;
    sidebarView.value = view;
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
    sidebarView,
    searchFocus,
    searchReplace,
    openSearch,
    toggleSidebar,
    showAgent,
    toggleAuxiliary
  };
});
