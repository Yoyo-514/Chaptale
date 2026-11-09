import { defineStore } from 'pinia';
import { ref } from 'vue';

import { useAgentStore } from '@/features/agent';

export const useWorkbenchStore = defineStore('workbench-navigation', () => {
  const sidebarOpen = ref(true);
  const auxiliaryOpen = ref(false);
  const agentInMain = ref(false);
  /** 会话视图里的子页；历史和会话设置都带「返回会话」。 */
  const agentView = ref<'chat' | 'history' | 'settings'>('chat');
  const statusBarOpen = ref(true);
  const focusMode = ref(false);
  function focusEditor() {
    agentInMain.value = false;
  }
  function toggleSidebar() {
    sidebarOpen.value = focusMode.value || !sidebarOpen.value;
    focusMode.value = false;
  }
  /** 在协作栏打开会话视图。 */
  function showAgent() {
    agentInMain.value = false;
    agentView.value = 'chat';
    auxiliaryOpen.value = true;
    focusMode.value = false;
  }
  function toggleAuxiliary() {
    if (auxiliaryOpen.value && !focusMode.value) auxiliaryOpen.value = false;
    else showAgent();
  }
  /** 由 Agent 读取章节，把事件记到涉及的资料下，结果进入审阅。 */
  function extractChapter(chapter: { id: string; title: string }) {
    showAgent();
    return useAgentStore().startReview(
      `请阅读《${chapter.title}》（条目 ID：${chapter.id}），把本章发生的事件记到涉及的资料下。` +
        '先查看这些资料已有的事件，不要重复记录；涉及的人物、地点等还没有资料时先在资料区新建。' +
        '再用 work_find 的 type 参数查找类型为“规划”的资料。规划中已在本章写成的内容不另记一条，在对应事件的依据末尾补上“规划《资料名》：原句”；规划资料本身不列为涉及的资料。'
    );
  }
  return {
    sidebarOpen,
    auxiliaryOpen,
    agentInMain,
    agentView,
    statusBarOpen,
    focusMode,
    focusEditor,
    toggleSidebar,
    showAgent,
    toggleAuxiliary,
    extractChapter
  };
});
