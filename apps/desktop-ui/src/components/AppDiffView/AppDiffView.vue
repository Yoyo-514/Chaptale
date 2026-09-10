<script setup lang="ts">
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, lineNumbers } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { selectionBackgroundTheme } from '@/utils/codemirror-selection';

const props = withDefaults(
  defineProps<{
    original: string;
    modified: string;
    originalLabel?: string;
    modifiedLabel?: string;
  }>(),
  { originalLabel: '当前版本', modifiedLabel: '新版本' }
);
const emit = defineEmits<{ selection: [range: { from: number; to: number }] }>();
const host = ref<HTMLElement | null>(null);
let view: MergeView | undefined;
function render() {
  if (!host.value) return;
  view?.destroy();
  const extensions = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    lineNumbers(),
    drawSelection(),
    EditorState.phrases.of({ '$ unchanged lines': '$ 行未改动' }),
    EditorView.theme({
      '&': { fontSize: '14px', background: 'var(--background)', color: 'var(--foreground)' },
      '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7' },
      '.cm-gutters': { color: 'var(--muted-foreground)', background: 'var(--surface-muted)' },
      '.cm-content': { padding: '8px 0' },
      ...selectionBackgroundTheme
    })
  ];
  view = new MergeView({
    parent: host.value,
    a: {
      doc: props.original,
      extensions: [
        ...extensions,
        EditorView.contentAttributes.of({ 'aria-label': props.originalLabel }),
        EditorView.updateListener.of(update => {
          if (update.selectionSet) {
            const { from, to } = update.state.selection.main;
            emit('selection', { from, to });
          }
        })
      ]
    },
    b: {
      doc: props.modified,
      extensions: [...extensions, EditorView.contentAttributes.of({ 'aria-label': props.modifiedLabel })]
    },
    collapseUnchanged: { margin: 3, minSize: 8 },
    diffConfig: { scanLimit: 1000 }
  });
}
onMounted(render);
watch(() => [props.original, props.modified], render);
onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <section class="app-diff" aria-label="版本对比">
    <header>
      <span>{{ originalLabel }}</span
      ><span>{{ modifiedLabel }}</span>
    </header>
    <div ref="host" class="app-diff-content" />
  </section>
</template>

<style scoped lang="scss">
.app-diff {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden;
}
header {
  @apply grid grid-cols-2 gap-2 border-b px-3 py-2 text-xs;
  border-color: var(--border-subtle);
}
header span {
  @apply min-w-0 truncate;
}
.app-diff-content {
  @apply min-h-0 flex-1 overflow-auto;
}
.app-diff-content :deep(.cm-mergeView) {
  min-height: 100%;
}
.app-diff-content :deep(.cm-mergeViewEditor) {
  min-width: 0;
}
</style>
