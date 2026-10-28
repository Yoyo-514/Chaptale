<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { EditCommand } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppDiffView } from '@/components/AppDiffView';
import { useNotificationStore } from '@/features/notifications';
import { toErrorMessage } from '@/utils/desktop-api';
import { captureEditingTarget } from '@/utils/editing-target';

import { createDocumentView } from '../codemirror/view';
import { useReadingStore } from '../reading/store';
import { useEditorStore } from '../store';
import type { EditorTab } from '../types';

const props = defineProps<{ tab: EditorTab; active: boolean }>();
const editor = useEditorStore();
const reading = useReadingStore();
const host = ref<HTMLElement>();
const compare = ref(false);
let view: ReturnType<typeof createDocumentView> | undefined;
let editingTarget: ReturnType<typeof captureEditingTarget>;
const menu: AppContextMenuItem[] = [
  { id: 'undo', label: '撤销', shortcut: 'Ctrl+Z' },
  { id: 'redo', label: '重做', shortcut: 'Ctrl+Y' },
  { id: 'cut', label: '剪切', shortcut: 'Ctrl+X', separatorBefore: true },
  { id: 'copy', label: '复制', shortcut: 'Ctrl+C' },
  { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
  { id: 'selectAll', label: '全选', shortcut: 'Ctrl+A' },
  { id: 'find', label: '查找', shortcut: 'Ctrl+F', separatorBefore: true },
  { id: 'replace', label: '替换', shortcut: 'Ctrl+H' }
];
function prepareMenu(event: MouseEvent) {
  editor.focusedId = props.tab.id;
  if (event.target instanceof HTMLInputElement) event.target.focus();
  else view!.focus();
  editingTarget = captureEditingTarget();
}
async function selectAction(id: string) {
  await nextTick();
  if (id === 'find' || id === 'replace') {
    view![id]();
    return;
  }
  if ((id === 'undo' || id === 'redo') && editingTarget.element?.isContentEditable) {
    view!.focus();
    view![id]();
    return;
  }
  try {
    await editingTarget.execute(id as EditCommand);
  } catch (cause) {
    useNotificationStore().error('编辑操作失败', toErrorMessage(cause));
  }
}
function render() {
  const savedPosition = view?.getViewState() ?? editor.viewState(props.tab);
  view?.destroy();
  view = createDocumentView(host.value!, props.tab.document!.content, {
    markdown: props.tab.format === 'markdown',
    large: false,
    buffer: editor.getBuffer(props.tab.id),
    viewState: savedPosition,
    onChange: buffer => editor.updateBuffer(props.tab.id, buffer),
    onPosition: position => editor.rememberView(props.tab.workId, props.tab.id, position)
  });
}
/** 从阅读切回编辑：等恢复滚动位置的帧之后再定位到读到的正文。 */
function consumeReveal() {
  const offset = view ? reading.takeReveal(props.tab.id) : null;
  if (offset !== null) requestAnimationFrame(() => view?.goTo(offset));
}
onMounted(() => {
  render();
  consumeReveal();
});
watch(() => reading.reveal, consumeReveal);
onBeforeUnmount(() => {
  if (view) {
    editor.rememberView(props.tab.workId, props.tab.id, view.getViewState());
    view.destroy();
  }
});
watch(() => props.tab.format, render);
watch(
  () => editor.searchRequest,
  () => {
    if (props.active) view?.find();
  }
);
watch(
  () => editor.command,
  value => {
    if (props.active && value) view?.[value.name]();
  }
);
</script>

<template>
  <section class="document-view" :aria-label="tab.title">
    <div v-if="tab.recovery" class="document-message" role="status">
      <span>此文档有上次未保存的草稿。</span>
      <AppButton size="xs" @click="editor.restoreRecovery(tab.id)">恢复草稿</AppButton>
      <AppButton size="xs" variant="ghost" @click="editor.discardRecovery(tab.id)">放弃草稿</AppButton>
    </div>
    <div v-if="tab.saveError || tab.recoveryError" class="document-message is-error" role="alert">
      <span>{{ tab.saveError || tab.recoveryError }}</span>
      <AppButton
        v-if="!tab.conflict"
        size="xs"
        @click="tab.saveError ? editor.saveDocument(tab.id) : editor.persistRecovery(tab.id)"
        >重试</AppButton
      >
    </div>
    <div v-if="tab.conflict" class="document-message">
      <span>已保存版本发生变化，本地输入已保留。</span>
      <AppButton size="xs" @click="compare = !compare">{{ compare ? '收起对比' : '对比版本' }}</AppButton>
      <AppButton size="xs" @click="editor.acceptSaved(tab.id)">采用已保存版本</AppButton>
      <AppButton size="xs" variant="danger" @click="editor.keepLocal(tab.id)">用本地内容保存</AppButton>
    </div>
    <div v-if="compare && tab.conflict" class="document-comparison">
      <AppDiffView
        :original="tab.conflict.content"
        :modified="editor.getBuffer(tab.id)!.content"
        original-label="已保存版本"
        modified-label="本地输入"
      />
    </div>
    <AppContextMenu :items="menu" @prepare="prepareMenu" @select="selectAction">
      <div class="document-codemirror-host">
        <!-- as-child 会处理触发节点的 ref；编辑器挂载点由本组件单独持有。 -->
        <div ref="host" class="document-editor-mount" />
      </div>
    </AppContextMenu>
  </section>
</template>

<style scoped>
.document-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.document-codemirror-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.document-editor-mount {
  height: 100%;
}
.document-message {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle);
}
.document-message.is-error {
  color: var(--destructive);
}
.document-comparison {
  display: flex;
  height: 35%;
  min-height: 100px;
  border-bottom: 1px solid var(--border-subtle);
}
</style>
