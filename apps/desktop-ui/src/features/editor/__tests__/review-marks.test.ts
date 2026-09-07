import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { reviewDecorations, setReviewMarks } from '../codemirror/review-marks';
function ranges(state: EditorState) {
  const result: number[][] = [];
  const marks = state.facet(EditorView.decorations)[0] as DecorationSet;
  marks.between(0, state.doc.length, (from, to) => {
    result.push([from, to]);
  });
  return result;
}
describe('审查波浪线', () => {
  it('标注随未保存编辑映射，重新锚定可替换或清空', () => {
    let state = EditorState.create({ doc: '原文引用', extensions: reviewDecorations(() => undefined) });
    state = state.update({ effects: setReviewMarks.of([{ id: '0', from: 2, to: 4, severity: 'high' }]) }).state;
    expect(ranges(state)).toEqual([[2, 4]]);
    state = state.update({ changes: { from: 0, insert: '新' } }).state;
    expect(ranges(state)).toEqual([[3, 5]]);
    state = state.update({ effects: setReviewMarks.of([]) }).state;
    expect(ranges(state)).toEqual([]);
  });
  it('越界和空范围不能导致编辑器崩溃', () => {
    let state = EditorState.create({ doc: '文', extensions: reviewDecorations(() => undefined) });
    state = state.update({
      effects: setReviewMarks.of([
        { id: '0', from: 0, to: 9, severity: 'low' },
        { id: '1', from: 0, to: 0, severity: 'low' }
      ])
    }).state;
    expect(ranges(state)).toEqual([]);
  });
});
