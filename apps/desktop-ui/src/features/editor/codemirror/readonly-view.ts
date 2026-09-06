import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { getSearchQuery, openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';

import type { DocumentViewState } from '../types';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', color: 'var(--foreground)', backgroundColor: 'var(--mica-background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.8' },
  '.cm-content': { padding: '20px 0 48px', caretColor: 'transparent' },
  '.cm-line': { padding: '0 24px 0 16px' },
  '.cm-gutters': {
    backgroundColor: 'var(--mica-background)',
    border: 'none',
    color: 'var(--muted-foreground)',
    fontSize: '11px'
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px 0 12px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent)' },
  '.cm-cursor': { display: 'none' },
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

/** CodeMirror 仅承担只读视图；原始文件内容留在 IPC 快照，绝不从归一化后的编辑器反向生成文件。 */
export function createReadonlyView(
  parent: HTMLElement,
  content: string,
  options: { markdown: boolean; large: boolean; viewState?: DocumentViewState }
) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorState.transactionFilter.of(transaction => (transaction.docChanged ? [] : transaction)),
        EditorView.contentAttributes.of({
          tabindex: '0',
          role: 'textbox',
          'aria-label': '文档正文',
          'aria-readonly': 'true',
          'aria-multiline': 'true'
        }),
        keymap.of([...searchKeymap, ...defaultKeymap]),
        search({ top: true }),
        drawSelection(),
        lineNumbers(),
        theme,
        EditorState.phrases.of({
          Find: '查找',
          Replace: '替换',
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
      ]
    })
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
    find: () => openSearchPanel(view),
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
