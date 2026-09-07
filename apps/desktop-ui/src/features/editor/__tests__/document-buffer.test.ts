import { redo, undo } from '@codemirror/commands';
import { type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { DocumentBuffer } from '../codemirror/document-buffer';

function historyTarget(buffer: DocumentBuffer) {
  return { state: buffer.state, dispatch: (transaction: Transaction) => buffer.update(transaction.state) };
}

describe('无损编辑缓冲', () => {
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
});
