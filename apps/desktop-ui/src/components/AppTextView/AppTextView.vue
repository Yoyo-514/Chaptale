<script setup lang="ts">
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { selectionBackgroundTheme } from '@/utils/codemirror-selection';

const props = defineProps<{ text: string; label: string }>();
const host = ref<HTMLElement>();
let view: EditorView | undefined;
onMounted(() => {
  view = new EditorView({
    parent: host.value,
    doc: props.text,
    extensions: [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      drawSelection(),
      EditorView.contentAttributes.of({ 'aria-label': props.label, tabindex: '0' }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '14px', color: 'var(--foreground)', background: 'var(--background)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.7' },
        '.cm-content': { padding: '8px' },
        '&.cm-focused': { outline: 'none', boxShadow: 'var(--input-focus-shadow)' },
        ...selectionBackgroundTheme
      })
    ]
  });
});
watch(
  () => props.text,
  text => view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
);
onBeforeUnmount(() => view?.destroy());
</script>
<template>
  <div ref="host" class="app-text-view" :aria-label="label" />
</template>
<style scoped lang="scss">
.app-text-view {
  @apply min-w-0 overflow-hidden;
  height: 18rem;
  max-height: 45vh;
}
</style>
