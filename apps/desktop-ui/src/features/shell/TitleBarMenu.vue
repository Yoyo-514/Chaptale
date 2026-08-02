<script setup lang="ts">
import { computed } from 'vue';

import { AppMenubar, type AppMenubarMenu } from '@/components/AppMenubar';
import { useWorkspaceStore } from '@/features/workspace';

const workspaceStore = useWorkspaceStore();

const menus = computed<readonly AppMenubarMenu[]>(() => [
  {
    id: 'file',
    label: '文件',
    items: [
      { id: 'file.new-workspace', label: '新建作品…', disabled: true },
      { id: 'file.open-workspace', label: '打开工作区…', disabled: workspaceStore.isOpening },
      { id: 'file.open-recent', label: '打开最近工作区…', disabled: true },
      { id: 'file.close-workspace', label: '关闭工作区', disabled: true, separatorBefore: true },
      { id: 'file.new-chapter', label: '新建章节', disabled: true, separatorBefore: true },
      { id: 'file.new-scene-card', label: '新建场景卡', disabled: true },
      { id: 'file.save', label: '保存', shortcut: 'Ctrl+S', disabled: true, separatorBefore: true },
      { id: 'file.save-all', label: '全部保存', disabled: true },
      { id: 'file.exit', label: '退出', disabled: true, separatorBefore: true }
    ]
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { id: 'edit.undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: true },
      { id: 'edit.redo', label: '重做', shortcut: 'Ctrl+Y', disabled: true },
      { id: 'edit.cut', label: '剪切', shortcut: 'Ctrl+X', disabled: true, separatorBefore: true },
      { id: 'edit.copy', label: '复制', shortcut: 'Ctrl+C', disabled: true },
      { id: 'edit.paste', label: '粘贴', shortcut: 'Ctrl+V', disabled: true },
      { id: 'edit.find', label: '查找', shortcut: 'Ctrl+F', disabled: true, separatorBefore: true },
      { id: 'edit.replace', label: '替换', shortcut: 'Ctrl+H', disabled: true }
    ]
  },
  {
    id: 'view',
    label: '视图',
    items: [
      { id: 'view.primary-sidebar', label: '切换主侧栏', disabled: true },
      { id: 'view.auxiliary-bar', label: '切换辅助栏', disabled: true },
      { id: 'view.status-bar', label: '切换状态栏', disabled: true },
      { id: 'view.internal-files', label: '显示内部文件', disabled: true, separatorBefore: true },
      { id: 'view.focus-mode', label: '专注模式', disabled: true }
    ]
  },
  {
    id: 'writing',
    label: '写作',
    items: [
      { id: 'writing.context', label: '组装本次参考', disabled: true },
      { id: 'writing.generate', label: '生成候选稿', disabled: true },
      { id: 'writing.settle', label: '结算当前章节', disabled: true, separatorBefore: true }
    ]
  },
  {
    id: 'agent',
    label: 'Agent',
    items: [
      { id: 'agent.new-session', label: '新建会话', disabled: true },
      { id: 'agent.switch-persona', label: '切换 Agent 角色', disabled: true },
      { id: 'agent.tasks', label: '查看任务', disabled: true, separatorBefore: true },
      { id: 'agent.cancel', label: '取消当前任务', disabled: true }
    ]
  },
  {
    id: 'review',
    label: '审查',
    items: [
      { id: 'review.continuity', label: '运行连贯性审查', disabled: true },
      { id: 'review.character', label: '运行人物审查', disabled: true },
      { id: 'review.style', label: '运行文风审查', disabled: true },
      { id: 'review.enabled', label: '运行已启用审查', disabled: true, separatorBefore: true },
      { id: 'review.center', label: '打开审查中心', disabled: true, separatorBefore: true }
    ]
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { id: 'help.guide', label: '使用说明', disabled: true },
      { id: 'help.diagnostics', label: '诊断信息', disabled: true },
      { id: 'help.about', label: '关于 Chaptale', disabled: true, separatorBefore: true }
    ]
  }
]);

function handleSelect(itemId: string) {
  if (itemId === 'file.open-workspace') {
    void workspaceStore.openWorkspace();
  }
}
</script>

<template>
  <AppMenubar :menus="menus" @select="handleSelect" />
</template>
