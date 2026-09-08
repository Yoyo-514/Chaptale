<script setup lang="ts">
import { computed } from 'vue';

import type { AssetRecord } from '@chaptale/shared';

import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceActions } from '@/features/workspace';

import { useStoryStore } from '../story-store';

const props = defineProps<{ asset: AssetRecord }>();
const editor = useEditorStore();
const library = useLibraryStore();
const navigation = useWorkbenchStore();
const actions = useWorkspaceActions();
const story = useStoryStore();
const items = computed<AppContextMenuItem[]>(() => [
  { id: 'open', label: '打开源文件', icon: 'i-mingcute-file-line' },
  ...(props.asset.kind === 'timeline-event'
    ? [{ id: 'event', label: '编辑故事事件', icon: 'i-mingcute-edit-line' }]
    : []),
  ...(props.asset.kind === 'character'
    ? [{ id: 'relation', label: '新建角色关系', icon: 'i-mingcute-link-line' }]
    : []),
  { id: 'agent', label: '与 Agent 讨论此资产', icon: 'i-mingcute-chat-3-line', separatorBefore: true },
  { id: 'reference', label: '加入写作参考', icon: 'i-mingcute-bookmark-add-line' },
  { id: 'rename', label: '重命名…', separatorBefore: true },
  { id: 'duplicate', label: '复制为新文件…' },
  { id: 'copy', label: '复制相对路径' },
  { id: 'reveal', label: '在系统文件管理器中显示' },
  { id: 'trash', label: '移到回收站…', danger: true, separatorBefore: true, icon: 'i-mingcute-delete-2-line' }
]);
function select(id: string) {
  if (id === 'open') void editor.openDocument(props.asset.sourcePath);
  else if (id === 'event') void story.editEvent(props.asset);
  else if (id === 'relation') void story.newRelation(props.asset.sourcePath);
  else if (id === 'agent') actions.askAgent(props.asset.sourcePath);
  else if (id === 'reference') {
    library.add(props.asset.sourcePath);
    navigation.showAuxiliary('references');
  } else if (id === 'copy') void actions.copyPath(props.asset.sourcePath);
  else if (id === 'reveal') void actions.reveal(props.asset.sourcePath);
  else if (id === 'rename' || id === 'duplicate' || id === 'trash') void actions.prepare(id, props.asset.sourcePath);
}
</script>
<template>
  <AppContextMenu :items="items" @select="select"><slot /></AppContextMenu>
</template>
