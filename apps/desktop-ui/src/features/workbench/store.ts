import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';

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
  /** 提取本章交代的资料、事件与关系，结果进入独立审阅会话。 */
  function extractChapter(chapter: { id: string; title: string }) {
    showAgent();
    return useAgentStore().startReview(
      `请阅读《${chapter.title}》（条目 ID：${chapter.id}），提取本章交代的资料、事件和关系，结果留作本会话待接受修改。\n` +
        '先在资料区（section: resource）检索相关资料并读取正文与属性，再用 work_record_ls、work_relation_ls 查阅已有事件和关系。沿用已有对象的稳定 ID，只处理与本章有关的内容。\n' +
        '资料正文只写原文明示的基础介绍和跨章稳定设定，例如身份、外貌、性格、背景；从正文直接开始介绍，标题由资料条目保存。动作、遭遇和状态变化记为事件，性格与关系以原文明示为准。\n' +
        '新资料先在资料区建立，放入现有合适目录，保持作者的目录组织。类型写入 attributes.type，优先沿用作品已有类型，需要时自定义。别名写入 attributes.aliases，只收录标题外的其他姓名、字号和稳定绰号；临时尊称、当次装扮的代称留在原文中。补充别名时保留已有别名。\n' +
        '已有资料正文只补充或修改相关句段，保留其余原文与作者表达。\n' +
        '本章发生的事写为事件，明确的关系变化记录建立或结束；同一件事可以同时产生事件和关系变化。新增或修改的依据引用本章原句，出处使用本章 ID，sourceRevisionId 填读取本章所得的修订。发生位置按事情实际发生的先后填写：开篇之前用 opening，位置待定用 undetermined。\n' +
        '再次提取时对照已有记录，提出新增或实际修改，避免重复新建；已有事件字段一致时保持原样。本章来源的旧事件或关系记录在新版中失去原文依据时，提出移除候选，依据中说明旧记录对应内容已从新版删除，交作者审阅；其他章节的记录保持原样。\n' +
        '再用 work_find 的 type 参数查找类型为“规划”的资料。规划中已在本章写成的内容沿用对应事件：新增或实际修改事件时，在依据末尾补上“规划《资料名》：原句”；已有事件保持原样时，在回复中说明对应规划及其原句。规划资料本身不列为涉及的资料。\n' +
        '本章正文保持原样。完成后简要说明提出了哪些资料、事件与关系修改，以及需要作者确认的事项。'
    );
  }
  function quoteToChat(context: EditorContext) {
    showAgent();
    useAgentStore().quoteSelection(context);
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
    extractChapter,
    quoteToChat
  };
});
