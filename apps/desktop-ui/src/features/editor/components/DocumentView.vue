<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import { matchAssetTemplate, validateTemplateValues, type AssetFieldValue, type AssetLink } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import { useLibraryStore } from '@/features/library';
import { useReviewStore } from '@/features/reviews';
import { TemplateFields, useTemplateStore } from '@/features/templates';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { DocumentBuffer } from '../codemirror/document-buffer';
import type { DocumentHeading } from '../codemirror/markdown-navigation';
import { createDocumentView } from '../codemirror/view';
import { useEditorStore } from '../store';
import type { DocumentViewState } from '../types';

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
const showForm = ref(false);
const formValues = ref<Record<string, unknown>>({});
const formError = ref('');
const assetTemplate = computed(() =>
  props.document.head.status === 'ok'
    ? matchAssetTemplate(templates.templates, props.document.head.frontmatter)
    : undefined
);
function syncForm() {
  const head = parseDocumentFrontmatter(props.buffer?.content ?? props.document.content);
  formValues.value = head.status === 'ok' ? head.frontmatter : {};
}
function changeField(key: string, value: AssetFieldValue) {
  if (!props.buffer || props.saving || props.readonly || props.conflict || !assetTemplate.value) return;
  try {
    const errors = validateTemplateValues(assetTemplate.value, { [key]: value }, false);
    if (errors.length) throw new Error(errors.join('\n'));
    const content = patchDocumentFields(props.buffer.content, { [key]: value });
    props.buffer.replaceContent(content);
    view?.foldHead();
    emit('change', props.buffer);
    syncForm();
    formError.value = '';
  } catch (error) {
    formError.value = toErrorMessage(error);
  }
}
watch(showForm, () => {
  syncForm();
  if (showForm.value) {
    view?.foldHead();
    if (!library.snapshot) void library.load();
  }
});
watch(() => props.document.contentHash, syncForm);
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
  navigation.auxiliary = 'references';
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
    <header class="document-toolbar">
      <span class="document-path" :title="document.relativePath">{{ document.relativePath }}</span>
      <div v-if="assetTemplate && !large" class="document-modes" role="tablist" aria-label="文档视图">
        <AppButton
          variant="ghost"
          size="xs"
          role="tab"
          :selected="showForm"
          :aria-selected="showForm"
          @click="showForm = true"
          >表单</AppButton
        >
        <AppButton
          variant="ghost"
          size="xs"
          role="tab"
          :selected="!showForm"
          :aria-selected="!showForm"
          @click="showForm = false"
          >源文件</AppButton
        >
      </div>
      <AppTooltip v-if="!large && document.head.status === 'ok'" text="折叠或展开元数据">
        <AppButton icon size="xs" variant="ghost" aria-label="折叠或展开元数据" @click="view?.toggleHead()">
          <span class="i-mingcute-braces-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip v-if="!large" text="标题大纲">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="标题大纲"
          :aria-pressed="showOutline"
          @click="
            showOutline = !showOutline;
            updateOutline();
          "
        >
          <span class="i-mingcute-list-check-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip v-if="!large" text="选段加入参考">
        <AppButton icon size="xs" variant="ghost" aria-label="选段加入参考" @click="addSelection">
          <span class="i-mingcute-bookmark-add-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <span v-if="large" class="document-readonly"
        ><span class="i-mingcute-lock-line size-3" aria-hidden="true" />只读</span
      >
      <span v-else class="document-readonly" role="status">{{
        saving ? '正在保存' : dirty ? '未保存' : '已保存'
      }}</span>
      <AppTooltip v-if="!large" text="保存文件" side="bottom">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="保存文件"
          :disabled="!dirty || saving"
          @click="emit('save')"
        >
          <span class="i-mingcute-save-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="在文档中查找" side="bottom">
        <AppButton icon size="xs" variant="ghost" aria-label="在文档中查找" @click="find">
          <span class="i-mingcute-search-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="重新读取" side="bottom">
        <AppButton icon size="xs" variant="ghost" aria-label="重新读取" @click="emit('reload')">
          <span class="i-mingcute-refresh-3-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </header>
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
    <div v-if="saveError || recoveryError || conflict" class="document-diagnostic" role="alert">
      {{ saveError || recoveryError || '磁盘版本与本地版本不同' }}
      <AppButton v-if="conflict" size="xs" @click="emit('compare')">对比版本</AppButton>
    </div>
    <details v-if="document.head.status === 'invalid'" class="document-diagnostic">
      <summary>frontmatter 无法解析</summary>
      <p>{{ document.head.error }}</p>
    </details>
    <AppScrollArea v-if="showForm && assetTemplate" class="document-form" aria-label="文档元数据表单">
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
            navigation.auxiliary = 'references';
          "
          >组装本次参考</AppButton
        >
      </div>
    </AppScrollArea>
    <div class="document-surface">
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
      <div ref="host" class="document-codemirror" />
      <span v-if="!(buffer?.state.doc.length ?? document.content.length)" class="document-empty" role="status"
        >空文件</span
      >
    </div>
    <footer class="document-footer">
      <span v-if="notice" class="mr-auto truncate" role="status">{{ notice }}</span>
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

.document-toolbar {
  @apply flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b px-2;
  font-size: var(--ui-font-size);

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.document-path {
  @apply min-w-0 flex-1 truncate pl-2;
}

.document-readonly {
  @apply mr-1 inline-flex shrink-0 items-center gap-1 text-xs;
}
.document-modes {
  @apply flex shrink-0 items-center gap-1;
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
</style>
