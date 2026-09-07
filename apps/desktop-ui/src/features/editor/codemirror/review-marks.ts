import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import type { ReviewMark } from '@chaptale/shared';

export const setReviewMarks = StateEffect.define<ReviewMark[]>();
const decorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setReviewMarks)) {
        value = Decoration.set(
          effect.value
            .filter(mark => mark.from >= 0 && mark.to > mark.from && mark.to <= transaction.state.doc.length)
            .map(mark =>
              Decoration.mark({
                class: `review-mark review-mark-${mark.severity}`,
                attributes: { 'data-review-issue': mark.id }
              }).range(mark.from, mark.to)
            ),
          true
        );
      }
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});
export function reviewDecorations(select: (id: string) => void) {
  return [
    decorations,
    EditorView.baseTheme({
      '.review-mark': {
        textDecorationLine: 'underline',
        textDecorationStyle: 'wavy',
        textUnderlineOffset: '4px',
        cursor: 'pointer'
      },
      '.review-mark-high': { textDecorationColor: 'var(--destructive)' },
      '.review-mark-medium': { textDecorationColor: '#ad760b' },
      '.review-mark-low': { textDecorationColor: 'var(--primary-solid)' }
    }),
    EditorView.domEventHandlers({
      click: event => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[data-review-issue]');
        if (!element?.dataset.reviewIssue) return false;
        select(element.dataset.reviewIssue);
        return false;
      }
    })
  ];
}
