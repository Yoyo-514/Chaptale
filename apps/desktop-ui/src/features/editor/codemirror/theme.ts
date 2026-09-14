import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { selectionBackgroundTheme } from '@/utils/codemirror-selection';

export const theme = EditorView.theme({
  ...selectionBackgroundTheme,
  '&': { height: '100%', fontSize: '14px', color: 'var(--foreground)', backgroundColor: 'var(--mica-background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '26px' },
  '.cm-content': { padding: '20px 0 48px', caretColor: 'var(--foreground)' },
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
  '.cm-panels': { color: 'var(--foreground)', backgroundColor: 'var(--surface-muted)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border-subtle)' },
  '.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 30px 8px 12px',
    fontSize: 'var(--ui-font-size)'
  },
  '.cm-search label': { display: 'inline-flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' },
  '.cm-search .cm-textfield': {
    width: '160px',
    maxWidth: '100%',
    minWidth: '0',
    background: 'var(--input)',
    color: 'var(--foreground)',
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-control)',
    minHeight: 'var(--control-height-sm)',
    font: 'inherit',
    padding: '4px 8px'
  },
  '.cm-search .cm-button': {
    background: 'var(--surface-muted)',
    color: 'var(--foreground)',
    border: '1px solid var(--border-subtle)',
    fontSize: 'var(--ui-font-size)',
    fontFamily: 'inherit',
    textTransform: 'none',
    minHeight: 'var(--control-height-sm)',
    borderRadius: 'var(--radius-control)',
    padding: '4px 8px'
  },
  '.cm-search input[type=checkbox]': { width: '24px', height: '24px', accentColor: 'var(--primary-solid)' },
  '.cm-search .cm-textfield:focus, .cm-search button:focus-visible, .cm-search input[type=checkbox]:focus-visible': {
    outline: 'none',
    boxShadow: 'var(--input-focus-shadow)'
  },
  '.cm-search .cm-button:hover': { background: 'var(--surface-hover)' },
  '.cm-search button[name=close]': {
    width: '28px',
    height: '28px',
    fontSize: '18px',
    color: 'var(--muted-foreground)',
    borderRadius: 'var(--radius-control)'
  },
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
