import { EditorView } from '@codemirror/view';

/** 长自然段（如传统章回小说千字大段）仍保留段内字级差异扫描。 */
export const DIFF_SCAN_LIMIT = 4000;

/** 同区与并排对比共用的差异样式：段落仅铺浅底、移除未改动文字删除线，突出段内增删字词。 */
export const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--destructive) 7%, transparent)'
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'color-mix(in srgb, var(--success) 8%, transparent)'
  },
  '.cm-deletedChunk del': {
    textDecoration: 'none',
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)'
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText': {
    background: 'none',
    backgroundColor: 'color-mix(in srgb, var(--destructive) 24%, transparent)',
    color: 'var(--foreground)',
    textDecoration: 'line-through',
    textDecorationColor: 'color-mix(in srgb, var(--destructive) 75%, transparent)',
    borderRadius: '2px',
    padding: '0 1px'
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'none',
    backgroundColor: 'color-mix(in srgb, var(--success) 26%, transparent)',
    color: 'var(--foreground)',
    borderRadius: '2px',
    padding: '0 1px'
  }
});
