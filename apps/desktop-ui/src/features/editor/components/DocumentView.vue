<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

import type { DocumentBuffer } from '../codemirror/document-buffer';
import { createDocumentView } from '../codemirror/view';
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
}>();
const emit = defineEmits<{
  reload: [];
  save: [];
  rememberView: [state: DocumentViewState];
  change: [buffer: DocumentBuffer];
}>();
const host = ref<HTMLElement | null>(null);
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

onMounted(() => {
  if (!host.value) return;
  view = createDocumentView(host.value, props.document.content, {
    markdown: /\.(md|markdown)$/i.test(props.document.relativePath),
    large: large.value,
    viewState: props.viewState,
    buffer: props.buffer,
    onChange: buffer => emit('change', buffer)
  });
  if (view.buffer) emit('change', view.buffer);
});
onBeforeUnmount(() => {
  if (!view) return;
  emit('rememberView', view.getViewState());
  view.destroy();
});
watch(() => props.searchRequest, find);
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
    <div v-if="saveError" class="document-diagnostic" role="alert">{{ saveError }}</div>
    <details v-if="document.head.status === 'invalid'" class="document-diagnostic">
      <summary>frontmatter 无法解析</summary>
      <p>{{ document.head.error }}</p>
    </details>
    <div class="document-surface">
      <div ref="host" class="document-codemirror" />
      <span v-if="!(buffer?.state.doc.length ?? document.content.length)" class="document-empty" role="status"
        >空文件</span
      >
    </div>
    <footer class="document-footer">
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
  @apply flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs;

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.document-path {
  @apply min-w-0 flex-1 truncate pl-2;
}

.document-readonly {
  @apply mr-1 inline-flex shrink-0 items-center gap-1 text-[11px];
}

.document-surface {
  @apply relative min-h-0 min-w-0 flex-1 overflow-hidden;
}

.document-codemirror {
  @apply h-full min-h-0 min-w-0;
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
  @apply flex h-6 shrink-0 items-center justify-end gap-3 border-t px-3 text-[11px];

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}
</style>
