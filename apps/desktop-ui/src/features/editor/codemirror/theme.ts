import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { selectionBackgroundTheme } from '@/utils/codemirror-selection';

export const theme = EditorView.theme({
  ...selectionBackgroundTheme,
  '&': { height: '100%', fontSize: '14px', color: 'var(--foreground)', backgroundColor: 'var(--mica-background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '26px' },
  '.cm-content': { padding: '4px 0 48px', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 24px 0 16px', transition: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--mica-background)',
    border: 'none',
    color: 'var(--muted-foreground)',
    fontSize: 'var(--ui-caption-size)',
    lineHeight: '26px',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontVariantNumeric: 'tabular-nums'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '36px',
    padding: '0 8px 0 12px',
    textAlign: 'right',
    transition: 'none'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--foreground) 4%, transparent)'
  },
  '&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--foreground) 7%, transparent)'
  },
  '.cm-activeLineGutter': { color: 'var(--foreground)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--muted-foreground)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-control-sm)'
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-panels-top': {
    position: 'absolute',
    top: '6px',
    right: '8px',
    left: 'auto',
    zIndex: '5',
    maxWidth: 'calc(100% - 16px)',
    border: 'none',
    backgroundColor: 'transparent'
  },
  '.cm-panel.cm-search': {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: '4px',
    width: 'min(420px, 100%)',
    boxSizing: 'border-box',
    padding: '6px',
    color: 'var(--foreground)',
    backgroundColor: 'var(--surface-elevated)',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-float)',
    borderRadius: 'var(--radius-control)',
    fontSize: 'var(--ui-font-size)'
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { margin: '0', boxSizing: 'border-box' },
  '.cm-search-field, .cm-search-actions': { display: 'flex', alignItems: 'center', minWidth: '0' },
  '.cm-search-field': {
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-control)',
    backgroundColor: 'var(--input)'
  },
  '.cm-search .cm-textfield': {
    width: '100%',
    minWidth: '0',
    height: '26px',
    padding: '3px 6px',
    font: 'inherit',
    color: 'var(--foreground)',
    background: 'var(--input)',
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-control)'
  },
  '.cm-search-field .cm-textfield': { flex: '1', height: '24px', border: 'none' },
  '.cm-search button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    width: '24px',
    height: '26px',
    padding: '3px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-control-sm)',
    color: 'var(--muted-foreground)',
    background: 'transparent',
    font: 'inherit',
    fontSize: '12px',
    cursor: 'pointer'
  },
  '.cm-search-field button': { width: '22px', height: '22px' },
  '.cm-search button svg': { display: 'block', width: '16px', height: '16px' },
  '.cm-search button[aria-expanded=true] svg': { transform: 'rotate(90deg)' },
  '.cm-search button[aria-pressed=true]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
    borderColor: 'var(--ring)'
  },
  '.cm-search-wholeWord': { textDecoration: 'underline' },
  '.cm-search button:hover:not(:disabled)': { backgroundColor: 'var(--surface-hover)' },
  '.cm-search button:disabled': { opacity: '0.45', cursor: 'default' },
  '.cm-search-field:focus-within, .cm-search .cm-textfield:focus, .cm-search button:focus-visible': {
    outline: '1px solid var(--ring)',
    outlineOffset: '-1px'
  },
  '.cm-search-field .cm-textfield:focus': { outline: 'none' },
  '.cm-search .cm-textfield[aria-invalid=true]': { outline: '1px solid var(--destructive)' },
  '.cm-replace-row': { display: 'grid', gridColumn: '2 / -1', gridTemplateColumns: 'minmax(0, 1fr) 72px', gap: '4px' },
  '.cm-replace-row[hidden]': { display: 'none' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent)' },
  '.cm-searchMatch-selected': { outline: '1px solid var(--primary-solid)' }
});

export const writingHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600', color: 'var(--foreground)' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--primary-solid)', textDecoration: 'underline' },
  { tag: [tags.meta, tags.comment], color: 'var(--muted-foreground)' },
  { tag: [tags.string, tags.monospace, tags.quote], color: 'var(--foreground)' }
]);

/** 同区对比的新增与删除标记，审阅与历史共用。 */
export const diffTheme = EditorView.theme({
  '.cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)' },
  '.cm-changedText': { backgroundColor: 'color-mix(in srgb, var(--success) 22%, transparent)' },
  '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' },
  '.cm-deletedChunk del, .cm-deletedText': {
    textDecoration: 'line-through',
    backgroundColor: 'color-mix(in srgb, var(--destructive) 18%, transparent)'
  }
});
