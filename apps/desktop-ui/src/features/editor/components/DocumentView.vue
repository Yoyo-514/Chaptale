<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { EditCommand, WorkspaceDocument } from '@chaptale/ipc-contract';
import type { AssetLink } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useLibraryStore } from '@/features/library';
import { StartFromScratchCard, useStartGuide } from '@/features/onboarding';
import { useReviewStore } from '@/features/reviews';
import { TemplateFields, useTemplateStore } from '@/features/templates';
import { useVersionStore } from '@/features/versions';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceActions } from '@/features/workspace';
import { useWritingStore } from '@/features/writing';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { DocumentBuffer } from '../codemirror/document-buffer';
import type { DocumentHeading } from '../codemirror/markdown-navigation';
import { createDocumentView } from '../codemirror/view';
import { useDocumentForm } from '../composables/useDocumentForm';
import { useEditorStore } from '../store';
import type { DocumentViewState } from '../types';
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
  notice?: string;
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
const library = useLibraryStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const reviews = useReviewStore();
const templates = useTemplateStore();
const versions = useVersionStore();
const fileActions = useWorkspaceActions();
const writing = useWritingStore();
// 长篇的第一步：作品刚建好、首章还是空的时候，把作者送去和「故事策划」把故事想清楚。
const {
  shouldShow: showStartGuide,
  isStarting: isStartingGuide,
  start: startGuide
} = useStartGuide(() => props.document);
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
    {
      id: 'reference',
      label: contextSelection.text ? '选段加入写作参考' : '文件加入写作参考',
      disabled: props.dirty || props.saving,
      icon: 'i-mingcute-bookmark-add-line'
    },
    { id: 'candidate', label: '生成候选稿…', disabled: props.readonly || props.dirty || props.saving },
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
    { id: 'versions', label: '查看版本历史' },
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
    } else if (id === 'reference') {
      library.add(props.document.relativePath, contextSelection.text || undefined);
      navigation.showAuxiliary('references');
    } else if (id === 'candidate') await writing.prepare();
    else if (id === 'save') emit('save');
    else if (id === 'versions') await versions.open();
    else if (id === 'reveal') await fileActions.reveal(props.document.relativePath);
    else if (id === 'find') find();
    else if (id === 'undo' || id === 'redo') view?.[id]();
    else {
      view?.goTo(contextSelection.from, contextSelection.to);
      await getDesktopApi().editCommand(id as EditCommand);
    }
  } catch (cause) {
    linkError.value = toErrorMessage(cause);
  }
}
const { showForm, formValues, formError, assetTemplate, syncForm, changeField } = useDocumentForm(
  props,
  buffer => emit('change', buffer),
  () => view?.foldHead()
);
const showOutline = ref(false);
const headings = ref<DocumentHeading[]>([]);
const linkResult = ref<AssetLink | null>(null);
const linkError = ref('');
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
const large = computed(() => props.readonly);
const size = computed(() => {
  const bytes = props.document.sizeBytes;
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
});
let view: ReturnType<typeof createDocumentView> | undefined;

function find() {
  view?.find();
}
function updateOutline() {
  headings.value = view?.headings() ?? [];
}
async function openLink(link: string) {
  try {
    const result = await getDesktopApi().library.resolveLink({ rootPath: props.document.rootPath, link });
    if (result.targetPath) await editor.openDocument(result.targetPath);
    else linkResult.value = result;
  } catch (error) {
    linkError.value = toErrorMessage(error);
  }
}
function addSelection() {
  const selection = view?.selection();
  if (!selection?.text) return;
  if (props.dirty) {
    linkError.value = '选段参考需要已保存的来源，请先保存文件';
    return;
  }
  library.add(props.document.relativePath, selection.text);
  navigation.showAuxiliary('references');
}

onMounted(() => {
  if (props.document.head.status === 'ok') void templates.load();
  if (!host.value) return;
  view = createDocumentView(host.value, props.document.content, {
    markdown: /\.(md|markdown)$/i.test(props.document.relativePath),
    large: large.value,
    viewState: props.viewState,
    buffer: props.buffer,
    onChange: buffer => {
      emit('change', buffer);
      if (showForm.value) syncForm();
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(updateOutline, 200);
    },
    foldHead: props.document.head.status === 'ok',
    assets: async () => {
      if (!library.snapshot) await library.load();
      return library.assets;
    },
    onOpenLink: link => {
      void openLink(link);
    },
    onReviewClick: reviews.selectMark
  });
  if (view.buffer) emit('change', view.buffer);
  updateOutline();
  view.setReviewMarks(reviews.marks(props.document.relativePath));
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
  () => reviews.marks(props.document.relativePath),
  marks => view?.setReviewMarks(marks),
  { deep: true }
);
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
    <DocumentToolbar
      :path="document.relativePath"
      :large="large"
      :has-metadata="document.head.status === 'ok'"
      :has-template="Boolean(assetTemplate)"
      :show-form="showForm"
      :show-outline="showOutline"
      :dirty="dirty"
      :saving="saving"
      @mode="showForm = $event"
      @metadata="view?.toggleHead()"
      @outline="
        showOutline = !showOutline;
        updateOutline();
      "
      @reference="addSelection"
      @assets="navigation.showAuxiliary('assets')"
      @versions="versions.open()"
      @save="emit('save')"
      @find="find"
      @reload="emit('reload')"
    />
    <div v-if="linkResult || linkError" class="document-diagnostic" role="status">
      <span>{{ linkError || (linkResult?.status === 'ambiguous' ? '引用存在多个同名来源' : '引用来源不存在') }}</span>
      <AppButton
        variant="link"
        v-for="candidate in linkResult?.candidates"
        :key="candidate"
        class="document-link-choice"
        @click="
          editor.openDocument(candidate);
          linkResult = null;
        "
      >
        {{ candidate }}
      </AppButton>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="关闭引用提示"
        @click="
          linkResult = null;
          linkError = '';
        "
        ><span class="i-mingcute-close-line size-3"
      /></AppButton>
    </div>
    <div v-if="saveError || recoveryError || conflict || versions.error" class="document-diagnostic" role="alert">
      {{ saveError || recoveryError || versions.error || '磁盘版本与本地版本不同' }}
      <AppButton v-if="conflict" size="xs" @click="emit('compare')">对比版本</AppButton>
    </div>
    <details v-if="document.head.status === 'invalid'" class="document-diagnostic">
      <summary>frontmatter 无法解析</summary>
      <p>{{ document.head.error }}</p>
    </details>
    <AppScrollArea
      v-if="assetTemplate"
      v-show="showForm"
      id="document-form-panel"
      class="document-form"
      aria-label="文档元数据表单"
    >
      <div class="document-form-content">
        <TemplateFields
          :fields="assetTemplate.fields"
          :values="formValues"
          :assets="library.available"
          :disabled="readonly || saving || conflict"
          @field="changeField"
        />
        <p v-if="formError" role="alert">{{ formError }}</p>
        <AppButton
          v-if="assetTemplate.targetKind === 'scene-card'"
          size="xs"
          :disabled="dirty || saving"
          @click="
            library.useScene(document.relativePath);
            navigation.showAuxiliary('references');
          "
          >组装本次参考</AppButton
        >
      </div>
    </AppScrollArea>
    <!-- 放在编辑器上方而非浮动层：空章节里还有标题行，浮上去会把标题盖住。 -->
    <StartFromScratchCard v-if="showStartGuide" :busy="isStartingGuide" @start="startGuide" />
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
    <footer class="document-footer">
      <span class="document-words">{{ editor.activeTab?.words ?? 0 }} 字</span>
      <span v-if="notice" class="truncate" role="status">{{ notice }}</span>
      <span v-if="large">大文件模式</span>
      <span>UTF-8</span>
      <span>{{ size }}</span>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.document-view {
  @apply flex h-full min-h-0 min-w-0 flex-col overflow-hidden;
}

.document-form {
  @apply min-h-0 shrink-0 border-b;
  max-height: 55%;
  border-color: var(--border-subtle);
}
.document-form-content {
  @apply mx-auto flex max-w-2xl flex-col gap-3 p-4;
}
.document-form :deep([data-slot='app-scroll-area-viewport']) {
  max-height: 100%;
}
.document-form-content [role='alert'] {
  @apply text-xs;
  color: var(--destructive);
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
  @apply pointer-events-none absolute left-17 top-5 text-sm;

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

.document-footer {
  @apply flex h-7 shrink-0 items-center justify-end gap-3 border-t px-3 text-xs;

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}
.document-words {
  margin-right: auto;
  white-space: nowrap;
}
</style>
