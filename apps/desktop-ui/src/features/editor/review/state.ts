import { historyKeymap, history, defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import { EditorState, Prec, type Range, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  WidgetType
} from '@codemirror/view';

import type { ReviewView } from '@chaptale/creation/contracts';

import { theme, writingHighlight } from '../codemirror/theme';

/** 逐处决定按钮条，记住所属修改块在候选稿中的起点。 */
class ChunkActions extends WidgetType {
  readonly fromB: number;

  constructor(fromB: number) {
    super();
    this.fromB = fromB;
  }

  override eq(other: ChunkActions) {
    return other.fromB === this.fromB;
  }

  toDOM() {
    const bar = document.createElement('div');
    bar.className = 'cm-reviewActions';
    bar.dataset.chunkFrom = String(this.fromB);
    for (const type of ['reject', 'accept'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.reviewAction = type;
      button.textContent = type === 'accept' ? '接受' : '拒绝';
      button.title = type === 'accept' ? '接受这一处修改' : '拒绝这一处修改';
      bar.append(button);
    }
    return bar;
  }

  override ignoreEvent() {
    return false;
  }
}

/** 按钮条放在每处修改的末尾：有新内容时跟在最后一行后，纯删除时跟在删除块后。 */
function chunkActions(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const chunk of getChunks(state)?.chunks ?? []) {
    const deco = (side: number) => Decoration.widget({ widget: new ChunkActions(chunk.fromB), block: true, side });
    ranges.push(chunk.toB > chunk.fromB ? deco(1).range(chunk.endB) : deco(-1).range(chunk.fromB));
  }
  return Decoration.set(ranges, true);
}

// 优先级最低：与删除块同位置时排在删除块之后。
const chunkActionsField = StateField.define<DecorationSet>({
  create: chunkActions,
  update: (value, transaction) =>
    getChunks(transaction.state)?.chunks === getChunks(transaction.startState)?.chunks
      ? value
      : chunkActions(transaction.state),
  provide: field => Prec.lowest(EditorView.decorations.from(field))
});

const reviewTheme = EditorView.theme({
  '.cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)' },
  '.cm-changedText': { backgroundColor: 'color-mix(in srgb, var(--success) 22%, transparent)' },
  '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--destructive) 8%, transparent)' },
  '.cm-deletedChunk del, .cm-deletedText': {
    textDecoration: 'line-through',
    backgroundColor: 'color-mix(in srgb, var(--destructive) 18%, transparent)'
  },
  '.cm-reviewActions': { display: 'flex', justifyContent: 'flex-end', gap: '4px', padding: '2px 8px 4px' },
  '.cm-reviewActions button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '22px',
    padding: '0 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-control-sm)',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    fontSize: 'var(--ui-caption-size)',
    lineHeight: '1',
    cursor: 'pointer'
  },
  '.cm-reviewActions button:hover': { background: 'var(--surface-muted)' }
});

/**
 * 编辑器正文为候选稿，原文为当前正式稿；逐块按钮只派发意图，由审阅面板按块位置提交作者决定。
 * 目录候选没有正文，只读显示。
 */
export function createReviewState(review: ReviewView): EditorState {
  const editable = review.candidate.content !== null;
  return EditorState.create({
    doc: review.candidate.content ?? '',
    extensions: [
      unifiedMergeView({
        original: review.current?.content ?? '',
        mergeControls: false,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 8 }
      }),
      editable && review.current !== null ? chunkActionsField : [],
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      EditorView.contentAttributes.of({ 'aria-label': `${review.candidate.title} 的待接受修改` }),
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      drawSelection(),
      lineNumbers(),
      EditorView.lineWrapping,
      EditorState.phrases.of({ '$ unchanged lines': '$ 行未改动' }),
      theme,
      reviewTheme,
      review.candidate.format === 'markdown' ? [markdown(), syntaxHighlighting(writingHighlight)] : []
    ]
  });
}
