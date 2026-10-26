import { acceptChunk, getChunks, getOriginalDoc, rejectChunk, unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';

import { chunkRange } from '../review/chunk-range';

function mergeView(rawA: string, rawB: string) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: rawB, extensions: unifiedMergeView({ original: rawA, mergeControls: false }) })
  });
}
const normalize = (text: string) => text.replaceAll(/\r\n?/g, '\n');

const cases: [string, string, string][] = [
  ['中间改一行', '甲\n乙\n丙', '甲\n改\n丙'],
  ['末行改写且无换行', '甲\n乙', '甲\n改'],
  ['候选在文末追加', '甲\n乙', '甲\n乙\n丙'],
  ['候选删去末行', '甲\n乙\n丙', '甲\n乙'],
  ['开头插入', '乙\n丙', '甲\n乙\n丙'],
  ['多处修改', '一\n二\n三\n四\n五', '一\n贰\n三\n四\n伍\n六'],
  ['原文为 CRLF', '甲\r\n乙\r\n丙', '甲\r\n改\r\n丙\r\n丁'],
  ['含代理对字符', '𠀀甲\n乙\n丙', '𠀀甲\n乙乙\n丙']
];

it.each(cases)('%s：逐块接受与拒绝的区间与编辑器结果一致', (_name, rawA, rawB) => {
  const probe = mergeView(rawA, rawB);
  const count = getChunks(probe.state)!.chunks.length;
  probe.destroy();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    for (const decision of ['accept', 'reject'] as const) {
      const view = mergeView(rawA, rawB);
      const chunk = getChunks(view.state)!.chunks[index];
      const range = chunkRange(chunk, getOriginalDoc(view.state), view.state.doc, rawA, rawB);
      expect(range).not.toBeNull();
      const { fromA, toA, fromB, toB } = range!;
      if (decision === 'accept') {
        acceptChunk(view, chunk.fromB);
        const accepted = rawA.slice(0, fromA) + rawB.slice(fromB, toB) + rawA.slice(toA);
        expect(normalize(accepted)).toBe(getOriginalDoc(view.state).toString());
      } else {
        rejectChunk(view, chunk.fromB);
        const rejected = rawB.slice(0, fromB) + rawA.slice(fromA, toA) + rawB.slice(toB);
        expect(normalize(rejected)).toBe(view.state.doc.toString());
      }
      view.destroy();
    }
  }
});
