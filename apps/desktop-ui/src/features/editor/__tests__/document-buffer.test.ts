import { redo, undo } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { DocumentBuffer } from '../codemirror/document-buffer';
import { createDocumentView } from '../codemirror/view';

function historyTarget(buffer: DocumentBuffer) {
  return { state: buffer.state, dispatch: (transaction: Transaction) => buffer.update(transaction.state) };
}

describe('无损编辑缓冲', () => {
  it('接受候选期间拦截编辑，确认后独立撤销一次回到原文', () => {
    const buffer = new DocumentBuffer('\uFEFF原文\r\n末尾\n');
    buffer.update(buffer.state.update({ changes: { from: 0, insert: '先前' }, userEvent: 'input.type' }).state);
    buffer.markSaved(buffer.state);
    const before = buffer.content;
    buffer.setLocked(true);
    buffer.update(buffer.state.update({ changes: { from: 0, insert: '意外输入' } }).state);
    expect(buffer.content).toBe(before);
    buffer.replaceContent('\uFEFF候选\r\n末尾\n', true);
    buffer.markSaved(buffer.state);
    buffer.setLocked(false);
    expect(buffer.dirty).toBe(false);
    expect(undo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe(before);
    expect(buffer.dirty).toBe(true);
    expect(undo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe('\uFEFF原文\r\n末尾\n');
  });
  it.each(['', '\uFEFF正文\r\n第二行\n末行\r', '甲\r乙\n丙\r\n'])('打开后字节等价：%j', raw => {
    const buffer = new DocumentBuffer(raw);
    expect(buffer.content).toBe(raw);
    expect(buffer.dirty).toBe(false);
  });

  it('编辑正文不改变未触及的换行和 BOM', () => {
    const buffer = new DocumentBuffer('\uFEFF甲\r\n乙\n丙\r丁');
    buffer.update(buffer.state.update({ changes: { from: 2, to: 3, insert: '乙改' } }).state);
    expect(buffer.content).toBe('\uFEFF甲\r\n乙改\n丙\r丁');
    expect(buffer.dirty).toBe(true);
  });

  it('合并的撤销恢复混合换行，重做仍保持同一内容', () => {
    const raw = '\uFEFF甲\r\n乙\n丙\r丁';
    const buffer = new DocumentBuffer(raw);
    buffer.update(buffer.state.update({ changes: { from: 1, to: 4 }, userEvent: 'delete.backward' }).state);
    buffer.update(buffer.state.update({ changes: { from: 1, to: 3 }, userEvent: 'delete.backward' }).state);
    const edited = buffer.content;
    expect(undo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe(raw);
    expect(buffer.dirty).toBe(false);
    expect(redo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe(edited);
  });

  it('多个不相邻改动按原坐标处理，新增换行采用文件主换行', () => {
    const buffer = new DocumentBuffer('甲\r\n乙\r\n丙\n丁');
    buffer.update(
      buffer.state.update({
        changes: [
          { from: 0, insert: '新\n' },
          { from: 6, to: 7, insert: '丁\n末' }
        ]
      }).state
    );
    expect(buffer.content).toBe('新\r\n甲\r\n乙\r\n丙\n丁\r\n末');
    undo(historyTarget(buffer));
    expect(buffer.content).toBe('甲\r\n乙\r\n丙\n丁');
  });

  it('保存只确认送出的状态，保存期间新增的文字仍为脏状态', () => {
    const buffer = new DocumentBuffer('原文');
    buffer.update(buffer.state.update({ changes: { from: 2, insert: '一' } }).state);
    const sent = buffer.state;
    buffer.update(buffer.state.update({ changes: { from: 3, insert: '二' } }).state);
    buffer.markSaved(sent);
    expect(buffer.content).toBe('原文一二');
    expect(buffer.dirty).toBe(true);
    buffer.markSaved(buffer.state);
    expect(buffer.dirty).toBe(false);
    undo(historyTarget(buffer));
    expect(buffer.dirty).toBe(true);
  });

  it.each([false, true])('连续输入跨过保存点后，一次撤销回到已保存内容（保存期间输入：%s）', pending => {
    const buffer = new DocumentBuffer('');
    buffer.update(
      buffer.state.update({
        changes: { from: 0, insert: '甲' },
        userEvent: 'input.type',
        annotations: Transaction.time.of(Date.UTC(2026, 0, 1))
      }).state
    );
    const sent = buffer.prepareSave();
    if (!pending) buffer.markSaved(sent);
    buffer.update(
      buffer.state.update({
        changes: { from: 1, insert: '乙' },
        userEvent: 'input.type',
        annotations: Transaction.time.of(Date.UTC(2026, 0, 1) + 1)
      }).state
    );
    if (pending) buffer.markSaved(sent);
    expect(buffer.content).toBe('甲乙');
    expect(buffer.dirty).toBe(true);
    expect(undo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe('甲');
    expect(buffer.dirty).toBe(false);
    expect(redo(historyTarget(buffer))).toBe(true);
    expect(buffer.content).toBe('甲乙');
    expect(buffer.dirty).toBe(true);
    undo(historyTarget(buffer));
    undo(historyTarget(buffer));
    expect(buffer.content).toBe('');
    expect(buffer.dirty).toBe(true);
  });

  it('恢复全文是一次可撤销事务，配置重挂载不改变磁盘基线', () => {
    const original = '\uFEFF甲\r\n乙\n';
    const restored = '\uFEFF新文\n末尾\r';
    const buffer = new DocumentBuffer(original);
    buffer.replaceContent(restored);
    buffer.configure([]);
    expect(buffer.content).toBe(restored);
    expect(buffer.dirty).toBe(true);
    undo(historyTarget(buffer));
    expect(buffer.content).toBe(original);
    expect(buffer.dirty).toBe(false);
  });

  it('同文档双开共享缓冲实时同步输入、跨侧撤销重做与保存状态，且各自保留独立选区', () => {
    const raw = '\uFEFF第一行\r\n第二行\n第三行';
    const buffer = new DocumentBuffer(raw);
    const leftHost = document.createElement('div');
    const rightHost = document.createElement('div');
    document.body.append(leftHost, rightHost);
    const left = createDocumentView(leftHost, raw, {
      markdown: false,
      large: false,
      buffer,
      viewState: { anchor: 0, head: 3, scrollTop: 0, scrollLeft: 0 }
    });
    const right = createDocumentView(rightHost, raw, {
      markdown: false,
      large: false,
      buffer,
      viewState: { anchor: 8, head: 11, scrollTop: 0, scrollLeft: 0 }
    });
    try {
      expect(left.selection().text).toBe('第一行');
      expect(right.selection().text).toBe('第三行');

      // 左侧在开头插入文字：右侧全文实时更新，且右侧选区随字符偏移自动映射，不被左侧光标覆盖。
      left.dispatch({ changes: { from: 0, insert: '卷首\n' }, userEvent: 'input.type' });
      expect(right.getState().doc.toString()).toBe('卷首\n第一行\n第二行\n第三行');
      expect(buffer.content).toBe('\uFEFF卷首\r\n第一行\r\n第二行\n第三行');
      expect(right.selection().text).toBe('第三行');
      expect(buffer.dirty).toBe(true);

      // 在右侧执行撤销，可撤销左侧刚才的操作，两侧同时回到干净状态并恢复原始混合换行。
      expect(right.undo()).toBe(true);
      expect(buffer.content).toBe(raw);
      expect(left.getState().doc.toString()).toBe(right.getState().doc.toString());
      expect(buffer.dirty).toBe(false);

      // 在左侧重做，两侧再次同步。
      expect(left.redo()).toBe(true);
      expect(buffer.dirty).toBe(true);
      expect(right.getState().doc.toString()).toBe('卷首\n第一行\n第二行\n第三行');
      expect(buffer.content).toBe('\uFEFF卷首\r\n第一行\r\n第二行\n第三行');
    } finally {
      left.destroy();
      right.destroy();
      leftHost.remove();
      rightHost.remove();
    }
  });
});
