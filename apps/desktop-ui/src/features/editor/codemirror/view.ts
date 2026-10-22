import { defaultKeymap, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  foldEffect,
  foldGutter,
  foldedRanges,
  foldService,
  syntaxHighlighting,
  unfoldEffect
} from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view';

import type { DocumentViewState } from '../types';
import { DocumentBuffer } from './document-buffer';
import { documentHeadings, documentHeadRange } from './markdown-navigation';
import { createSearchPanel, openReplacePanel } from './search-panel';
import { theme, writingHighlight } from './theme';

function position(view: EditorView): DocumentViewState {
  return {
    anchor: view.state.selection.main.anchor,
    head: view.state.selection.main.head,
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft
  };
}

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
    onPosition?: (position: DocumentViewState) => void;
    foldHead?: boolean;
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
    keymap.of([
      { key: 'Mod-h', mac: 'Mod-Alt-f', run: openReplacePanel, scope: 'editor search-panel', preventDefault: true },
      ...historyKeymap,
      ...searchKeymap,
      ...defaultKeymap
    ]),
    search({ top: true, createPanel: createSearchPanel }),
    drawSelection(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
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
    options.markdown && !options.large
      ? [
          markdown(),
          syntaxHighlighting(writingHighlight),
          foldGutter(),
          foldService.of((state, from) => (from === 0 ? documentHeadRange(state) : null))
        ]
      : []
  ];
  const buffer = options.large ? null : (options.buffer ?? new DocumentBuffer(content, extensions));
  buffer?.configure(extensions);
  const view = new EditorView({
    parent,
    state: buffer?.state ?? EditorState.create({ doc: content, extensions }),
    dispatchTransactions(transactions, currentView) {
      currentView.update(transactions);
      if (transactions.some(transaction => transaction.selection || transaction.docChanged))
        options.onPosition?.(position(currentView));
      if (buffer) {
        buffer.update(currentView.state);
        if (transactions.some(transaction => transaction.docChanged)) options.onChange?.(buffer);
      }
    }
  });
  const rememberPosition = () => options.onPosition?.(position(view));
  view.scrollDOM.addEventListener('scroll', rememberPosition, { passive: true });
  const detachBuffer = buffer?.attach(transaction => view.dispatch(transaction));
  const head = options.markdown && !options.large && options.foldHead ? documentHeadRange(view.state) : null;
  if (head && !options.viewState) {
    view.dispatch({
      effects: foldEffect.of(head),
      selection: { anchor: Math.min(head.to + 1, view.state.doc.length) }
    });
  }

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
    focus: () => view.focus(),
    find: () => openSearchPanel(view),
    replace: () => openReplacePanel(view),
    undo: () => undo(view),
    redo: () => redo(view),
    headings: () => documentHeadings(view.state),
    selection: () => {
      const { from, to } = view.state.selection.main;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
    goTo(from: number, to = from) {
      view.dispatch({
        selection: { anchor: Math.min(from, view.state.doc.length), head: Math.min(to, view.state.doc.length) },
        scrollIntoView: true
      });
      view.focus();
    },
    toggleHead() {
      const range = documentHeadRange(view.state);
      if (!range) return;
      let folded = false;
      foldedRanges(view.state).between(range.from, range.to, () => {
        folded = true;
      });
      view.dispatch({ effects: (folded ? unfoldEffect : foldEffect).of(range) });
    },
    foldHead() {
      const range = documentHeadRange(view.state);
      if (range) view.dispatch({ effects: foldEffect.of(range) });
    },
    getViewState: () => position(view),
    destroy() {
      detachBuffer?.();
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
      view.scrollDOM.removeEventListener('scroll', rememberPosition);
      view.destroy();
    }
  };
}
