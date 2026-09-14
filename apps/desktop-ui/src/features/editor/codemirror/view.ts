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
import { getSearchQuery, openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view';

import type { AssetRecord, ReviewMark } from '@chaptale/shared';

import type { DocumentViewState } from '../types';
import { DocumentBuffer } from './document-buffer';
import { documentHeadings, documentHeadRange, wikiLinks } from './markdown-navigation';
import { reviewDecorations, setReviewMarks } from './review-marks';
import { theme, writingHighlight } from './theme';

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
    assets?: () => Promise<readonly AssetRecord[]>;
    onOpenLink?: (link: string) => void;
    foldHead?: boolean;
    onReviewClick?: (id: string) => void;
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
    highlightActiveLine(),
    highlightActiveLineGutter(),
    theme,
    ...(options.onReviewClick ? reviewDecorations(options.onReviewClick) : []),
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
          foldService.of((state, from) => (from === 0 ? documentHeadRange(state) : null)),
          ...(options.assets && options.onOpenLink
            ? [wikiLinks({ assets: options.assets, open: options.onOpenLink })]
            : [])
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
      if (buffer) {
        buffer.update(currentView.state);
        if (transactions.some(transaction => transaction.docChanged)) options.onChange?.(buffer);
      }
    }
  });
  const detachBuffer = buffer?.attach(transaction => view.dispatch(transaction));
  const head = options.markdown && !options.large && options.foldHead ? documentHeadRange(view.state) : null;
  if (head && !options.viewState) {
    view.dispatch({
      effects: foldEffect.of(head),
      selection: { anchor: Math.min(head.to + 1, view.state.doc.length) }
    });
  }

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
    focus: () => view.focus(),
    setReviewMarks: (marks: ReviewMark[]) => view.dispatch({ effects: setReviewMarks.of(marks) }),
    find: () => openSearchPanel(view),
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
    getViewState: (): DocumentViewState => ({
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft
    }),
    destroy() {
      detachBuffer?.();
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
      view.dom.removeEventListener('input', updateSearchInput);
      view.dom.removeEventListener('compositionend', updateSearchInput);
      view.destroy();
    }
  };
}
