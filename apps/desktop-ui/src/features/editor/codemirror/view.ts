import { defaultKeymap, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { getSearchQuery, openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';

import type { DocumentViewState } from '../types';
import { DocumentBuffer } from './document-buffer';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', color: 'var(--foreground)', backgroundColor: 'var(--mica-background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.8' },
  '.cm-content': { padding: '20px 0 48px', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 24px 0 16px' },
  '.cm-gutters': {
    backgroundColor: 'var(--mica-background)',
    border: 'none',
    color: 'var(--muted-foreground)',
    fontSize: '11px'
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px 0 12px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-panels': { color: 'var(--foreground)', backgroundColor: 'var(--surface-muted)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border-subtle)' },
  '.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 30px 8px 12px',
    fontSize: '12px'
  },
  '.cm-search label': { display: 'inline-flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' },
  '.cm-search .cm-textfield': {
    width: '160px',
    maxWidth: '100%',
    minWidth: '0',
    background: 'var(--input-background)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)'
  },
  '.cm-search .cm-button': {
    background: 'var(--surface-muted)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    fontSize: '12px',
    borderRadius: '3px',
    padding: '2px 6px'
  },
  '.cm-searchMatch': { backgroundColor: 'var(--accent)' },
  '.cm-searchMatch-selected': { outline: '1px solid var(--primary-solid)' }
});

/** 视图可卸载，正文、原始换行与撤销历史由标签的 DocumentBuffer 持有。 */
export function createDocumentView(
  parent: HTMLElement,
  content: string,
  options: {
    markdown: boolean;
    large: boolean;
    viewState?: DocumentViewState;
    buffer?: DocumentBuffer;
    onChange?: (buffer: DocumentBuffer) => void;
  }
) {
  const extensions = [
    EditorState.readOnly.of(options.large),
    EditorView.editable.of(!options.large),
    ...(options.large
      ? [EditorState.transactionFilter.of(transaction => (transaction.docChanged ? [] : transaction))]
      : []),
    EditorView.contentAttributes.of({
      tabindex: '0',
      role: 'textbox',
      'aria-label': '文档正文',
      'aria-readonly': String(options.large),
      'aria-multiline': 'true'
    }),
    keymap.of([...historyKeymap, ...searchKeymap, ...defaultKeymap]),
    search({ top: true }),
    drawSelection(),
    lineNumbers(),
    theme,
    EditorState.phrases.of({
      Find: '查找',
      Replace: '替换',
      replace: '替换',
      'replace all': '全部替换',
      next: '下一个',
      previous: '上一个',
      all: '全部',
      'match case': '区分大小写',
      regexp: '正则表达式',
      'by word': '全词匹配',
      close: '关闭',
      'current match': '当前匹配'
    }),
    options.large ? [] : EditorView.lineWrapping,
    options.markdown && !options.large ? [markdown(), syntaxHighlighting(defaultHighlightStyle)] : []
  ];
  const buffer = options.large ? null : (options.buffer ?? new DocumentBuffer(content, extensions));
  const view = new EditorView({
    parent,
    state: buffer?.state ?? EditorState.create({ doc: content, extensions }),
    dispatchTransactions(transactions, currentView) {
      currentView.update(transactions);
      if (buffer) {
        buffer.update(currentView.state);
        if (transactions.some(transaction => transaction.docChanged)) options.onChange?.(buffer);
      }
    }
  });

  // 搜索框也接收粘贴与输入法提交，不能只等 keyup 后才让 Enter 使用新查询。
  const updateSearchInput = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.closest('.cm-search')) return;
    if (input.name !== 'search' && input.name !== 'replace') return;
    if (event instanceof InputEvent && event.isComposing) return;
    const query = new SearchQuery({ ...getSearchQuery(view.state), [input.name]: input.value });
    view.dispatch({ effects: setSearchQuery.of(query) });
  };
  view.dom.addEventListener('input', updateSearchInput);
  view.dom.addEventListener('compositionend', updateSearchInput);

  let restoreFrame: number | undefined;
  if (options.viewState) {
    const saved = options.viewState;
    view.dispatch({
      selection: EditorSelection.single(
        Math.min(saved.anchor, view.state.doc.length),
        Math.min(saved.head, view.state.doc.length)
      )
    });
    restoreFrame = requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = saved.scrollTop;
      view.scrollDOM.scrollLeft = saved.scrollLeft;
    });
  }

  return {
    buffer,
    find: () => openSearchPanel(view),
    undo: () => undo(view),
    redo: () => redo(view),
    getViewState: (): DocumentViewState => ({
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft
    }),
    destroy() {
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
      view.dom.removeEventListener('input', updateSearchInput);
      view.dom.removeEventListener('compositionend', updateSearchInput);
      view.destroy();
    }
  };
}
