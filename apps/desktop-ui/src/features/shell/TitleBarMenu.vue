<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRouter } from 'vue-router';

import { isChaptaleTheme } from '@chaptale/ipc-contract';
import type { EditCommand } from '@chaptale/ipc-contract';

import { AppMenubar, type AppMenubarMenu } from '@/components/AppMenubar';
import { useContentStore } from '@/features/content';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useOnboardingStore } from '@/features/onboarding';
import { useReviewStore } from '@/features/reviews';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { useSettlementStore } from '@/features/settlement';
import { useTemplateStore } from '@/features/templates';
import { useVersionStore } from '@/features/versions';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { useWritingStore } from '@/features/writing';
import { toErrorMessage } from '@/utils/desktop-api';
import { captureEditingTarget } from '@/utils/editing-target';

const workspaceStore = useWorkspaceStore();
const settingsStore = useSettingsStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const activeDocument = computed(() => (navigation.center === 'editor' ? editor.activeTab : undefined));
const writing = useWritingStore();
const reviews = useReviewStore();
const templates = useTemplateStore();
const settlement = useSettlementStore();
const versions = useVersionStore();
const sessions = useSessionStore();
const router = useRouter();
const content = useContentStore();
const editTarget = shallowRef<ReturnType<typeof captureEditingTarget>>();
function captureEditTarget() {
  editTarget.value = captureEditingTarget();
}

/** 主题项的 id 前缀；handleSelect 靠它还原出主题取值。 */
const THEME_ITEM_PREFIX = 'view.theme.';

const themeItems = computed(() => {
  // 设置尚未读到时不预设勾——猜一个再纠正，比空着更容易让人误解。
  const current = settingsStore.state?.settings.theme;

  return [
    { id: `${THEME_ITEM_PREFIX}light`, label: '浅色', checked: current === 'light' },
    { id: `${THEME_ITEM_PREFIX}warm`, label: '暖色', checked: current === 'warm' },
    { id: `${THEME_ITEM_PREFIX}dark`, label: '深色', checked: current === 'dark' }
  ];
});
const recentItems = computed(() =>
  (settingsStore.state?.settings.recentWorkspaces ?? []).map(path => ({ id: `file.recent.${path}`, label: path }))
);

const menus = computed<readonly AppMenubarMenu[]>(() => [
  {
    id: 'file',
    label: '文件',
    items: [
      { id: 'file.new-workspace', label: '新建作品…', disabled: workspaceStore.isOpening },
      { id: 'file.open-workspace', label: '打开工作区…', disabled: workspaceStore.isOpening },
      {
        id: 'file.open-recent',
        label: '打开最近工作区…',
        disabled: recentItems.value.length === 0,
        items: recentItems.value
      },
      { id: 'file.close-workspace', label: '关闭工作区', disabled: !workspaceStore.rootPath, separatorBefore: true },
      {
        id: 'file.close-editor',
        label: '关闭标签',
        shortcut: 'Ctrl+W',
        disabled: navigation.center === 'editor' && !editor.activeId
      },
      { id: 'file.new-chapter', label: '新建章节', disabled: !workspaceStore.rootPath, separatorBefore: true },
      { id: 'file.new-scene-card', label: '新建场景卡', disabled: !workspaceStore.rootPath },
      { id: 'file.new-asset', label: '从模板新建', disabled: !workspaceStore.rootPath },
      {
        id: 'file.save',
        label: '保存',
        shortcut: 'Ctrl+S',
        disabled: !activeDocument.value?.dirty,
        separatorBefore: true
      },
      { id: 'file.save-all', label: '全部保存', shortcut: 'Ctrl+Shift+S', disabled: !editor.hasUnsaved },
      { id: 'file.auto-save', label: '自动保存', checked: editor.autoSave },
      { id: 'file.sync', label: '文件与同步…', separatorBefore: true }
    ]
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { id: 'edit.undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: !editTarget.value?.editable },
      { id: 'edit.redo', label: '重做', shortcut: 'Ctrl+Y', disabled: !editTarget.value?.editable },
      { id: 'edit.cut', label: '剪切', shortcut: 'Ctrl+X', separatorBefore: true },
      { id: 'edit.copy', label: '复制', shortcut: 'Ctrl+C' },
      { id: 'edit.paste', label: '粘贴', shortcut: 'Ctrl+V' },
      { id: 'edit.selectAll', label: '全选', shortcut: 'Ctrl+A' },
      {
        id: 'edit.find',
        label: '查找',
        shortcut: 'Ctrl+F',
        disabled: activeDocument.value?.status !== 'ready',
        separatorBefore: true
      },
      {
        id: 'edit.replace',
        label: '替换',
        shortcut: 'Ctrl+H',
        disabled: !activeDocument.value || activeDocument.value.readonly
      }
    ]
  },
  {
    id: 'view',
    label: '视图',
    items: [
      { id: 'view.primary-sidebar', label: '主侧栏', checked: navigation.sidebarOpen },
      { id: 'view.auxiliary-bar', label: '辅助栏', checked: navigation.auxiliaryOpen },
      { id: 'view.status-bar', label: '状态栏', checked: navigation.statusBarOpen },
      { id: 'view.focus-mode', label: '专注模式', checked: navigation.focusMode },
      { id: 'view.appearance', label: '外观', separatorBefore: true, items: themeItems.value }
    ]
  },
  {
    id: 'writing',
    label: '写作',
    items: [
      { id: 'writing.context', label: '组装本次参考', disabled: !workspaceStore.rootPath },
      { id: 'writing.generate', label: '生成候选稿', disabled: !activeDocument.value || activeDocument.value.readonly },
      {
        id: 'writing.settle',
        label: '结算当前章节',
        disabled: !activeDocument.value || activeDocument.value.readonly,
        separatorBefore: true
      },
      {
        id: 'writing.finalize',
        label: '定稿当前章节',
        disabled: !activeDocument.value || activeDocument.value.readonly
      },
      { id: 'writing.versions', label: '查看文档版本', disabled: !activeDocument.value?.document }
    ]
  },
  {
    id: 'agent',
    label: 'Agent',
    items: [
      { id: 'agent.new-session', label: '新建会话', disabled: navigation.agentBusy },
      {
        id: 'agent.switch-persona',
        label: '切换 Agent 角色',
        disabled: navigation.agentBusy,
        items: [
          ...content.chats.map(persona => ({
            id: `agent.persona.${persona.id}`,
            label: persona.name,
            checked: (sessions.currentSession?.personaId ?? 'companion') === persona.id
          })),
          { id: 'agent.manage-personas', label: '管理专员', separatorBefore: true }
        ]
      },
      { id: 'agent.tasks', label: '查看运行记录', separatorBefore: true },
      { id: 'agent.cancel', label: '停止当前对话', disabled: !navigation.agentBusy || navigation.agentCancelling }
    ]
  },
  {
    id: 'review',
    label: '审查',
    items: [
      { id: 'review.continuity', label: '运行连贯性审查', disabled: !activeDocument.value },
      { id: 'review.character', label: '运行人物审查', disabled: !activeDocument.value },
      { id: 'review.style', label: '运行文风审查', disabled: !activeDocument.value },
      { id: 'review.enabled', label: '运行已启用审查', disabled: !activeDocument.value, separatorBefore: true },
      { id: 'review.center', label: '打开审查中心', disabled: !workspaceStore.rootPath, separatorBefore: true }
    ]
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { id: 'help.guide', label: '开始引导' },
      { id: 'help.diagnostics', label: '配置与诊断' }
    ]
  }
]);

function handleSelect(itemId: string) {
  if (itemId === 'help.guide') {
    useOnboardingStore().show();
    return;
  }
  if (itemId === 'agent.manage-personas') {
    settingsStore.openPanel('content');
    return;
  }
  if (itemId === 'agent.new-session' || itemId.startsWith('agent.persona.')) {
    if (navigation.agentBusy) return;
    navigation.showAuxiliary('agent');
    void sessions
      .createSession({
        name: '新会话',
        personaId: itemId.startsWith('agent.persona.')
          ? itemId.slice('agent.persona.'.length)
          : sessions.currentSession?.personaId
      })
      .then(() => router.push({ name: 'chat' }))
      .catch(error => useNotificationStore().error('新建会话失败', toErrorMessage(error)));
    return;
  }
  if (itemId === 'agent.tasks') {
    navigation.showAuxiliary('runs');
    return;
  }
  if (itemId === 'agent.cancel') {
    navigation.cancelAgentRequest++;
    return;
  }
  if (itemId === 'help.diagnostics') {
    settingsStore.openPanel('files');
    return;
  }
  if (['edit.cut', 'edit.copy', 'edit.paste', 'edit.selectAll', 'edit.undo', 'edit.redo'].includes(itemId)) {
    if ((itemId === 'edit.undo' || itemId === 'edit.redo') && editTarget.value?.element?.closest('.cm-editor')) {
      editTarget.value.element.focus();
      editor.requestCommand(itemId === 'edit.undo' ? 'undo' : 'redo');
      return;
    }
    void editTarget.value
      ?.execute(itemId.slice(5) as EditCommand)
      .catch(error => useNotificationStore().error('编辑操作失败', toErrorMessage(error)));
    return;
  }
  if (itemId === 'file.new-workspace') {
    workspaceStore.newWorkspaceOpen = true;
    return;
  }
  if (itemId === 'file.sync') {
    workspaceStore.syncOpen = true;
    return;
  }
  if (itemId === 'view.primary-sidebar') {
    navigation.sidebarOpen = !navigation.sidebarOpen;
    return;
  }
  if (itemId === 'view.auxiliary-bar') {
    navigation.auxiliaryOpen = !navigation.auxiliaryOpen;
    return;
  }
  if (itemId === 'view.status-bar') {
    navigation.statusBarOpen = !navigation.statusBarOpen;
    return;
  }
  if (itemId === 'view.focus-mode') {
    navigation.focusMode = !navigation.focusMode;
    return;
  }
  if (itemId === 'writing.finalize') {
    versions.prepareFinal();
    return;
  }
  if (itemId === 'writing.versions') {
    void versions.open();
    return;
  }
  if (itemId === 'writing.settle') {
    void settlement.prepare();
    return;
  }
  if (itemId === 'file.new-scene-card' || itemId === 'file.new-asset') {
    const tab = activeDocument.value;
    void templates.openCreate(
      itemId === 'file.new-scene-card' ? 'scene-card' : 'chapter',
      itemId === 'file.new-scene-card' &&
        tab?.document?.head.status === 'ok' &&
        tab.document.head.frontmatter.kind === 'chapter'
        ? { chapter: `[[${tab.path}]]` }
        : {}
    );
    return;
  }
  if (itemId === 'review.center') {
    navigation.showSidebar('review');
    navigation.showAuxiliary('review');
    return;
  }
  if (itemId.startsWith('review.')) {
    void reviews.prepare(itemId === 'review.enabled' ? undefined : `${itemId.slice(7)}-reviewer`);
    return;
  }
  if (itemId === 'writing.generate') {
    void writing.prepare();
    return;
  }
  if (itemId === 'writing.context') {
    navigation.showAuxiliary('references');
    return;
  }
  if (itemId === 'file.new-chapter') {
    editor.newChapterOpen = true;
    return;
  }
  if (itemId === 'file.save') {
    void editor.saveDocument();
    return;
  }
  if (itemId === 'file.save-all') {
    void editor.saveAll();
    return;
  }
  if (itemId === 'file.auto-save') {
    void editor.setAutoSave(!editor.autoSave);
    return;
  }
  if (itemId === 'file.close-editor') {
    if (navigation.center !== 'editor') navigation.closeView(navigation.center);
    else void editor.closeTab(editor.activeId);
    return;
  }
  if (itemId === 'edit.find' || itemId === 'edit.replace') {
    editor.requestSearch();
    return;
  }
  if (itemId === 'file.open-workspace') {
    void workspaceStore.openWorkspace();
    return;
  }
  if (itemId === 'file.close-workspace') {
    void workspaceStore.closeWorkspace();
    return;
  }
  if (itemId.startsWith('file.recent.')) {
    void workspaceStore.openRecent(itemId.slice('file.recent.'.length));
    return;
  }

  if (itemId.startsWith(THEME_ITEM_PREFIX)) {
    const theme = itemId.slice(THEME_ITEM_PREFIX.length);

    if (isChaptaleTheme(theme)) {
      void settingsStore.setTheme(theme);
    }
  }
}
</script>

<template>
  <AppMenubar :menus="menus" @pointerdown.capture="captureEditTarget" @select="handleSelect" />
</template>
