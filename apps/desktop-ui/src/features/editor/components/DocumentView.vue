<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { EditCommand, WorkspaceDocument } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceActions } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { DocumentBuffer } from '../codemirror/document-buffer';
import type { DocumentHeading } from '../codemirror/markdown-navigation';
import { createDocumentView } from '../codemirror/view';
import { useEditorStore } from '../store';
import type { DocumentViewState } from '../types';
import DocumentBreadcrumb from './DocumentBreadcrumb.vue';
import DocumentToolbar from './DocumentToolbar.vue';

const props = defineProps<{
  document: WorkspaceDocument;
  readonly: boolean;
  viewState?: DocumentViewState;
  searchRequest: number;
  buffer?: DocumentBuffer;
  command?: { name: 'undo' | 'redo'; sequence: number } | null;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string;
  recoveryError?: string;
  conflict?: boolean;
}>();
const emit = defineEmits<{
  reload: [];
  save: [];
  rememberView: [state: DocumentViewState];
  change: [buffer: DocumentBuffer];
  compare: [];
}>();
const host = ref<HTMLElement | null>(null);
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const fileActions = useWorkspaceActions();
const contextItems = ref<AppContextMenuItem[]>([]);
let contextSelection = { from: 0, to: 0, text: '' };
function prepareContext() {
  contextSelection = view?.selection() ?? { from: 0, to: 0, text: '' };
  contextItems.value = [
    {
      id: 'agent',
      label: contextSelection.text ? '与 Agent 讨论选段' : '与 Agent 讨论此文件',
      icon: 'i-mingcute-chat-3-line'
    },
    { id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: props.readonly, separatorBefore: true },
    { id: 'redo', label: '重做', shortcut: 'Ctrl+Y', disabled: props.readonly },
    {
      id: 'cut',
      label: '剪切',
      shortcut: 'Ctrl+X',
      disabled: props.readonly || !contextSelection.text,
      separatorBefore: true
    },
    { id: 'copy', label: '复制', shortcut: 'Ctrl+C', disabled: !contextSelection.text, icon: 'i-mingcute-copy-2-line' },
    { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', disabled: props.readonly },
    { id: 'selectAll', label: '全选', shortcut: 'Ctrl+A' },
    { id: 'find', label: '查找与替换', shortcut: 'Ctrl+F', separatorBefore: true },
    {
      id: 'save',
      label: '保存',
      shortcut: 'Ctrl+S',
      disabled: !props.dirty || props.saving,
      icon: 'i-mingcute-save-line'
    },
    { id: 'reveal', label: '在系统文件管理器中显示' }
  ];
}
async function selectContext(id: string) {
  try {
    if (id === 'agent') {
      if (contextSelection.text.length > 32000) throw new Error('选段超过 32000 字符，请缩小选区');
      if (!contextSelection.text) fileActions.askAgent(props.document.relativePath);
      else
        navigation.askAgent(
          props.document.rootPath,
          `请围绕《${props.document.relativePath}》的这段文字协助创作${props.dirty ? '（来自未保存的编辑缓冲）' : ''}：\n\n${contextSelection.text}`
        );
    } else if (id === 'save') emit('save');
    else if (id === 'reveal') await fileActions.reveal(props.document.relativePath);
    else if (id === 'find') find();
    else if (id === 'undo' || id === 'redo') view?.[id]();
    else {
      view?.goTo(contextSelection.from, contextSelection.to);
      await getDesktopApi().editCommand(id as EditCommand);
    }
  } catch (cause) {
    actionError.value = toErrorMessage(cause);
  }
}
const showOutline = ref(false);
const headings = ref<DocumentHeading[]>([]);
const actionError = ref('');
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
const large = computed(() => props.readonly);
let view: ReturnType<typeof createDocumentView> | undefined;

function find() {
  view?.find();
}
function goToHeading(heading: DocumentHeading) {
  view?.goTo(heading.from, heading.to);
}
function updateOutline() {
  headings.value = view?.headings() ?? [];
}
onMounted(() => {
  if (!host.value) return;
  view = createDocumentView(host.value, props.document.content, {
    markdown: /\.(md|markdown)$/i.test(props.document.relativePath),
    large: large.value,
    viewState: props.viewState,
    buffer: props.buffer,
    onChange: buffer => {
      emit('change', buffer);
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(updateOutline, 200);
    },
    foldHead: props.document.head.status === 'ok'
  });
  if (view.buffer) emit('change', view.buffer);
  updateOutline();
  if (editor.location?.path === props.document.relativePath) view.goTo(editor.location.from, editor.location.to);
});
onBeforeUnmount(() => {
  if (!view) return;
  clearTimeout(outlineTimer);
  emit('rememberView', view.getViewState());
  view.destroy();
});
watch(() => props.searchRequest, find);
watch(
  () => editor.location,
  location => {
    if (location?.path === props.document.relativePath) view?.goTo(location.from, location.to);
  }
);
watch(
  () => props.command,
  command => {
    if (command) view?.[command.name]();
  }
);
</script>

<template>
  <section class="document-view">
    <DocumentBreadcrumb
      :path="document.relativePath"
      :headings="headings"
      @open="updateOutline"
      @heading="goToHeading"
    />
    <DocumentToolbar
      :path="document.relativePath"
      :large="large"
      :has-metadata="document.head.status === 'ok'"
      :show-outline="showOutline"
      :dirty="dirty"
      :saving="saving"
      @metadata="view?.toggleHead()"
      @outline="
        showOutline = !showOutline;
        updateOutline();
      "
      @save="emit('save')"
      @find="find"
      @reload="emit('reload')"
    />
    <div v-if="actionError" class="document-diagnostic" role="alert">{{ actionError }}</div>
    <div v-if="saveError || recoveryError || conflict" class="document-diagnostic" role="alert">
      {{ saveError || recoveryError || '磁盘版本与本地版本不同' }}
      <AppButton v-if="conflict" size="xs" @click="emit('compare')">对比版本</AppButton>
    </div>
    <details v-if="document.head.status === 'invalid'" class="document-diagnostic">
      <summary>frontmatter 无法解析</summary>
      <p>{{ document.head.error }}</p>
    </details>
    <div id="document-source-panel" class="document-surface">
      <AppScrollArea v-if="showOutline" class="document-outline">
        <nav aria-label="标题大纲">
          <p v-if="!headings.length" class="p-3 text-xs">没有标题</p>
          <AppButton
            variant="ghost"
            v-for="heading in headings"
            :key="heading.from"
            :style="{ paddingLeft: `${12 + (heading.level - 1) * 10}px` }"
            :title="heading.title"
            @click="view?.goTo(heading.from, heading.to)"
          >
            {{ heading.title }}
          </AppButton>
        </nav>
      </AppScrollArea>
      <AppContextMenu :items="contextItems" @prepare="prepareContext" @select="selectContext">
        <div class="document-codemirror">
          <!-- 插槽根节点可能被上层克隆；编辑器挂载引用由本组件内部节点持有。 -->
          <div ref="host" class="document-codemirror-host" />
        </div>
      </AppContextMenu>
      <span v-if="!(buffer?.state.doc.length ?? document.content.length)" class="document-empty" role="status"
        >空文件</span
      >
    </div>
  </section>
</template>

<style scoped lang="scss">
.document-view {
  @apply flex h-full min-h-0 min-w-0 flex-col overflow-hidden;
}

.document-surface {
  @apply relative flex min-h-0 min-w-0 flex-1 overflow-hidden;
}

.document-codemirror {
  @apply h-full min-h-0 min-w-0 flex-1;
}
.document-codemirror-host {
  @apply h-full min-h-0 min-w-0;
}
.document-outline {
  @apply h-full w-40 max-w-[35%] shrink-0 border-r;
  border-color: var(--border-subtle);
}
.document-outline button {
  @apply block w-full truncate rounded-none border-0 bg-transparent py-1 pr-2 text-left;
  color: var(--muted-foreground);
}
.document-outline button:hover {
  background: var(--accent);
  color: var(--foreground);
}
.document-link-choice {
  @apply m-1 border-0 bg-transparent underline;
  color: var(--primary-solid);
}

.document-empty {
  @apply pointer-events-none absolute left-17 top-1 text-sm;

  color: var(--muted-foreground);
}

.document-diagnostic {
  @apply max-h-32 shrink-0 overflow-auto border-b px-4 py-2 text-xs;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--destructive);
  overflow-wrap: anywhere;
}

.document-diagnostic summary {
  cursor: pointer;
}

.document-diagnostic p {
  @apply mt-2 whitespace-pre-wrap;
}
</style>
