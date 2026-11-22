<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue';

import { isChaptaleTheme, type EditCommand } from '@chaptale/desktop/bridge';

import { AppMenubar, type AppMenubarMenu } from '@/components/AppMenubar';
import { useAgentStore } from '@/features/agent';
import { useCloudSyncStore } from '@/features/cloud-sync';
import { useCreationStore, useWorkPackageStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { captureEditingTarget } from '@/utils/editing-target';

import AboutDialog from './help/AboutDialog.vue';
import KeyboardShortcutsDialog from './help/KeyboardShortcutsDialog.vue';
import UpdateDetailsDialog from './help/UpdateDetailsDialog.vue';
import { useAppUpdateStore } from './help/updates';
import { useInterfaceZoom } from './useInterfaceZoom';

const creation = useCreationStore();
const settings = useSettingsStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const agent = useAgentStore();
const packages = useWorkPackageStore();
const cloud = useCloudSyncStore();
const updates = useAppUpdateStore();
const isDesktop = hasDesktopApi();
const isMac = navigator.platform.startsWith('Mac');
const modifier = isMac ? 'Cmd' : 'Ctrl';
const helpDialog = ref<'about' | 'shortcuts'>();
let pendingHelpDialog: 'about' | 'shortcuts' | undefined;
let helpTrigger: HTMLElement;

function handOffHelpFocus(menuId: string, trigger: HTMLElement) {
  if (menuId !== 'help' || !pendingHelpDialog) return;
  helpTrigger = trigger;
  // 鼠标选择菜单项时，弹窗可能记录即将卸载的菜单项。关闭时明确回到「帮助」。
  helpDialog.value = pendingHelpDialog;
  pendingHelpDialog = undefined;
}

function restoreHelpFocus(event: Event) {
  event.preventDefault();
  const trigger = helpTrigger;
  void nextTick(() => trigger.focus());
}

async function exportPackage() {
  const work = creation.works.find(item => item.id === creation.workId);
  if (!work) return;
  try {
    const path = await packages.exportWork(work);
    if (path) useNotificationStore().success(`已导出《${work.title}》`, path);
  } catch (cause) {
    useNotificationStore().error('导出作品包失败', toErrorMessage(cause));
  }
}
const { zoom } = useInterfaceZoom();
const editTarget = shallowRef<ReturnType<typeof captureEditingTarget>>();
/** 会话只在作品内打开，作品库不提供会话入口。 */
const sessionsAvailable = computed(() => Boolean(creation.workId) && !creation.libraryOpen);
const activeDocument = computed(() => editor.activeTab);
const menus = computed<readonly AppMenubarMenu[]>(() => [
  {
    id: 'file',
    label: '文件',
    items: [
      { id: 'file.new-work', label: '新建作品…', disabled: !creation.connected },
      { id: 'file.library', label: '作品库' },
      {
        id: 'file.new-document',
        label: '新建文档',
        disabled: creation.libraryOpen || !creation.workId,
        separatorBefore: true
      },
      {
        id: 'file.writing-guidelines',
        label: '写作要求…',
        disabled: creation.libraryOpen || !creation.workId || !creation.connected
      },
      {
        id: 'file.import',
        label: '导入文稿与资料…',
        disabled: creation.libraryOpen || !creation.workId || !creation.connected
      },
      { id: 'file.export', label: '导出正文…', disabled: creation.libraryOpen || !creation.workId },
      { id: 'file.import-package', label: '导入作品包…', disabled: !creation.connected, separatorBefore: true },
      {
        id: 'file.export-package',
        label: '导出作品包…',
        disabled: creation.libraryOpen || !creation.workId || !creation.connected
      },
      {
        ...cloud.backupMenu,
        // 没登录时这一项是“登录云端账户…”，不依赖当前作品。
        disabled:
          cloud.backupMenu.disabled ||
          (cloud.accounts.length > 0 && (creation.libraryOpen || !creation.workId || !creation.connected)),
        separatorBefore: true
      },
      { id: 'file.cloud-restore', label: '从云端恢复…', disabled: !creation.connected },
      {
        id: 'file.save',
        label: '保存',
        shortcut: `${modifier}+S`,
        disabled: !activeDocument.value?.dirty,
        separatorBefore: true
      },
      { id: 'file.save-all', label: '全部保存', shortcut: `${modifier}+Shift+S`, disabled: !editor.hasUnsaved },
      { id: 'file.auto-save', label: '自动保存', checked: editor.autoSave },
      {
        id: 'file.close-editor',
        label: '关闭标签',
        shortcut: `${modifier}+W`,
        disabled: !editor.activeId
      },
      { id: 'file.settings', label: '设置…' }
    ]
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { id: 'edit.undo', label: '撤销', shortcut: `${modifier}+Z`, disabled: !editTarget.value?.editable },
      {
        id: 'edit.redo',
        label: '重做',
        shortcut: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
        disabled: !editTarget.value?.editable
      },
      { id: 'edit.cut', label: '剪切', shortcut: `${modifier}+X`, separatorBefore: true },
      { id: 'edit.copy', label: '复制', shortcut: `${modifier}+C` },
      { id: 'edit.paste', label: '粘贴', shortcut: `${modifier}+V` },
      { id: 'edit.selectAll', label: '全选', shortcut: `${modifier}+A` },
      {
        id: 'edit.find',
        label: '查找',
        shortcut: `${modifier}+F`,
        disabled: activeDocument.value?.status !== 'ready',
        separatorBefore: true
      },
      {
        id: 'edit.replace',
        label: '替换',
        shortcut: isMac ? 'Cmd+Option+F' : 'Ctrl+H',
        disabled: activeDocument.value?.status !== 'ready'
      }
    ]
  },
  {
    id: 'view',
    label: '视图',
    items: [
      { id: 'view.primary-sidebar', label: '作品导航', checked: navigation.sidebarOpen },
      { id: 'view.auxiliary-bar', label: '协作栏', checked: navigation.auxiliaryOpen },
      { id: 'view.status-bar', label: '状态栏', checked: navigation.statusBarOpen },
      { id: 'view.focus-mode', label: '专注模式', checked: navigation.focusMode },
      { id: 'view.zoom-in', label: '放大界面', shortcut: `${modifier}++`, separatorBefore: true },
      { id: 'view.zoom-out', label: '缩小界面', shortcut: `${modifier}+-` },
      { id: 'view.zoom-reset', label: '重置缩放', shortcut: `${modifier}+0` },
      {
        id: 'view.appearance',
        label: '外观',
        separatorBefore: true,
        items: [
          { id: 'view.theme.light', label: '浅色', checked: settings.state?.settings.theme === 'light' },
          { id: 'view.theme.warm', label: '暖色', checked: settings.state?.settings.theme === 'warm' },
          { id: 'view.theme.dark', label: '深色', checked: settings.state?.settings.theme === 'dark' }
        ]
      }
    ]
  },
  {
    id: 'agent',
    label: '会话',
    items: [
      { id: 'agent.new', label: '新建会话', disabled: agent.connecting || !sessionsAvailable.value },
      { id: 'agent.history', label: '历史会话', disabled: agent.connecting || !sessionsAvailable.value },
      { id: 'agent.cancel', label: '停止当前会话', disabled: !agent.connected || !agent.active?.running },
      { id: 'agent.models', label: '模型设置…', separatorBefore: true },
      { id: 'agent.instructions', label: '默认指令与模式…' }
    ]
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { id: 'help.shortcuts', label: '快捷键一览…' },
      { id: 'help.open-data', label: '打开数据目录', disabled: !isDesktop },
      {
        id: 'help.check-update',
        label: updates.checkingManually ? '正在检查更新…' : '检查更新',
        separatorBefore: true,
        disabled: !isDesktop || updates.checkingManually
      },
      { id: 'help.report', label: '反馈问题…', disabled: !isDesktop },
      { id: 'help.about', label: '关于…', separatorBefore: true, disabled: !isDesktop }
    ]
  }
]);
function handleSelect(id: string) {
  if (id.startsWith('view.zoom-')) {
    void zoom(id === 'view.zoom-in' ? 'in' : id === 'view.zoom-out' ? 'out' : 'reset');
    return;
  }
  if (id.startsWith('view.theme.')) {
    const theme = id.slice('view.theme.'.length);
    if (isChaptaleTheme(theme)) void settings.setTheme(theme);
    return;
  }
  if (['edit.cut', 'edit.copy', 'edit.paste', 'edit.selectAll', 'edit.undo', 'edit.redo'].includes(id)) {
    if ((id === 'edit.undo' || id === 'edit.redo') && editTarget.value?.element?.closest('.cm-editor')) {
      editTarget.value.element.focus();
      editor.requestCommand(id === 'edit.undo' ? 'undo' : 'redo');
    } else
      void editTarget.value
        ?.execute(id.slice(5) as EditCommand)
        .catch(cause => useNotificationStore().error('编辑操作失败', toErrorMessage(cause)));
    return;
  }
  if (cloud.selectBackup(id, creation.work)) return;
  switch (id) {
    case 'file.new-work':
      creation.newWorkOpen = true;
      break;
    case 'file.library':
      void creation.showLibrary();
      break;
    case 'file.new-document':
      creation.newEntry = { kind: 'document', parentId: null };
      break;
    case 'file.writing-guidelines':
      creation.writingGuidelinesOpen = true;
      break;
    case 'file.import':
      creation.importOpen = true;
      break;
    case 'file.export':
      creation.exportOpen = true;
      break;
    case 'file.import-package':
      // 导入结果与同作品的选择框显示在作品库。
      void creation.showLibrary().then(() => packages.chooseImport());
      break;
    case 'file.export-package':
      void exportPackage();
      break;
    case 'file.cloud-restore':
      // 恢复列表与同作品的选择框显示在作品库。
      void creation.showLibrary().then(() => cloud.openRestore());
      break;
    case 'file.save':
      void editor.saveDocument();
      break;
    case 'file.save-all':
      void editor.saveAll();
      break;
    case 'file.auto-save':
      void editor.setAutoSave(!editor.autoSave);
      break;
    case 'file.close-editor':
      void editor.closeTab(editor.activeId, editor.activeGroup);
      break;
    case 'file.settings':
      settings.openPanel();
      break;
    case 'edit.find':
    case 'edit.replace':
      editor.requestSearch();
      break;
    case 'view.primary-sidebar':
      navigation.sidebarOpen = !navigation.sidebarOpen;
      break;
    case 'view.auxiliary-bar':
      navigation.toggleAuxiliary();
      break;
    case 'view.status-bar':
      navigation.statusBarOpen = !navigation.statusBarOpen;
      break;
    case 'view.focus-mode':
      navigation.focusMode = !navigation.focusMode;
      break;
    case 'agent.new':
      agent.newDraft();
      navigation.showAgent();
      break;
    case 'agent.history':
      navigation.showAgent();
      navigation.agentView = 'history';
      break;
    case 'agent.cancel':
      void agent.perform(() => getDesktopApi().agentHost.request('cancel', { id: agent.activeId! }));
      break;
    case 'agent.models':
      settings.openPanel('llm');
      break;
    case 'agent.instructions':
      settings.openPanel('prompt');
      break;
    case 'help.shortcuts':
      pendingHelpDialog = 'shortcuts';
      break;
    case 'help.open-data':
      void getDesktopApi()
        .dataDirectory.open()
        .catch(cause => {
          useNotificationStore().error('打开数据目录失败', toErrorMessage(cause));
        });
      break;
    case 'help.check-update':
      void updates.checkNow();
      break;
    case 'help.report':
      void getDesktopApi()
        .help.reportIssue()
        .catch(cause => {
          useNotificationStore().error('打开 GitHub 反馈页失败', toErrorMessage(cause));
        });
      break;
    case 'help.about':
      pendingHelpDialog = 'about';
      break;
  }
}
</script>
<template>
  <AppMenubar
    :menus="menus"
    @pointerdown.capture="editTarget = captureEditingTarget()"
    @select="handleSelect"
    @close-auto-focus="handOffHelpFocus"
  />
  <KeyboardShortcutsDialog
    v-if="helpDialog === 'shortcuts'"
    :menus="menus"
    :modifier="modifier"
    @close="helpDialog = undefined"
    @close-auto-focus="restoreHelpFocus"
  />
  <AboutDialog v-if="helpDialog === 'about'" @close="helpDialog = undefined" @close-auto-focus="restoreHelpFocus" />
  <UpdateDetailsDialog v-if="updates.details" :update="updates.details" @close="updates.details = null" />
</template>
