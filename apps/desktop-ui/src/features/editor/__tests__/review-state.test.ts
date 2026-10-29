import { getChunks } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';

import type { EntryReviewView, EntrySnapshot } from '@chaptale/creation/contracts';

import { createReviewState } from '../review/state';

let view: EditorView | undefined;
afterEach(() => view?.destroy());

const snapshot = (content: string): EntrySnapshot =>
  ({ title: '第一章', kind: 'document', format: 'txt', content }) as EntrySnapshot;

function mount(current: string | null, candidate: string) {
  const review = {
    current: current === null ? null : snapshot(current),
    candidate: snapshot(candidate),
    conflicts: []
  } as unknown as EntryReviewView;
  view = new EditorView({ parent: document.body, state: createReviewState(review) });
  return view;
}

/** 正文区里按显示顺序排列的行、删除块与按钮条。 */
const blocks = (target: EditorView) =>
  [...target.contentDOM.children].map(node =>
    node.classList.contains('cm-reviewActions')
      ? `按钮:${(node as HTMLElement).dataset.chunkFrom}`
      : node.classList.contains('cm-deletedChunk')
        ? `删除:${node.textContent}`
        : node.textContent
  );

it('每处修改的接受、拒绝按钮跟在该处最后一行之后，并记住修改块起点', () => {
  const target = mount('甲\n乙\n丙\n丁', '甲\n改一\n改二\n丙\n丁\n新增');
  const starts = getChunks(target.state)!.chunks.map(chunk => chunk.fromB);
  expect(blocks(target)).toEqual([
    '甲',
    '删除:乙',
    '改一',
    '改二',
    `按钮:${starts[0]}`,
    '丙',
    // 原文末行没有换行，追加内容时末行也属于这处修改。
    '删除:丁',
    '丁',
    '新增',
    `按钮:${starts[1]}`
  ]);
  expect(
    [...target.contentDOM.querySelectorAll<HTMLElement>('.cm-reviewActions')].map(bar =>
      [...bar.querySelectorAll<HTMLElement>('button')].map(button => button.dataset.reviewAction)
    )
  ).toEqual([
    ['reject', 'accept'],
    ['reject', 'accept']
  ]);
});

it('只删除的修改把按钮放在删除块之后；新建条目没有逐处按钮', () => {
  const deleted = mount('甲\n乙\n丙', '甲\n丙');
  expect(blocks(deleted)).toEqual(['甲', '删除:乙', `按钮:${getChunks(deleted.state)!.chunks[0].fromB}`, '丙']);
  deleted.destroy();
  const created = mount(null, '新的开头');
  expect(created.contentDOM.querySelector('.cm-reviewActions')).toBeNull();
});
