import { describe, expect, it } from 'vitest';

import type { ReviewIssue } from '../reviews';
import { applyRewriteEdits, rewriteSpans } from '../rewrite';
import { validateOutput } from '../task-output';

const issue = (quote: string, start?: number): ReviewIssue => ({
  agentType: 'style',
  type: 'flat_rhythm',
  severity: 'low',
  quote,
  reason: '重复',
  suggestion: '最小修改',
  ...(start === undefined ? {} : { position: { start } })
});
const edit = (original: string, replacement: string) => ({ original, replacement, rationale: '对应选中的节奏问题' });
describe('最小修订', () => {
  it('多个词级修改共用同一行，未触及行和混合换行一字不动', () => {
    const raw = '\uFEFF前言。\r\n他慢慢地走，慢慢地说。\n保持 \t 原样。\r尾声。\r\n';
    const spans = rewriteSpans(raw, [issue('他慢慢地走'), issue('慢慢地说')]);
    expect(spans).toHaveLength(1);
    expect(applyRewriteEdits(raw, [edit('他慢慢地走', '他踱步'), edit('慢慢地说', '轻声说')], spans)).toBe(
      '\uFEFF前言。\r\n他踱步，轻声说。\n保持 \t 原样。\r尾声。\r\n'
    );
  });
  it('跨行问题只授权触及行，允许删除文字', () => {
    const raw = '前\n甲。\n乙。\n后';
    const spans = rewriteSpans(raw, [issue('甲。\n乙。')]);
    expect(spans).toEqual([{ from: 2, to: 7, text: '甲。\n乙。' }]);
    expect(applyRewriteEdits(raw, [edit('乙。', '')], spans)).toBe('前\n甲。\n\n后');
    expect(() => applyRewriteEdits(raw, [edit('后', '越界')], spans)).toThrow('超出');
  });
  it('重复引用必须有精确坐标，归一化模糊定位不能授权写入', () => {
    expect(() => rewriteSpans('甲。\n甲。', [issue('甲。')])).toThrow('歧义');
    expect(rewriteSpans('甲。\n甲。', [issue('甲。', 3)])).toEqual([{ from: 3, to: 5, text: '甲。' }]);
    expect(() => rewriteSpans('甲。\n甲。', [issue('甲。', 1)])).toThrow('歧义');
    expect(() => rewriteSpans('你好，世界。', [issue('你好,世界.')])).toThrow('失锚');
  });
  it('重复 old_text、重叠、变化的授权行和无效输出快速失败', () => {
    const raw = '甲甲乙';
    const spans = rewriteSpans(raw, [issue(raw)]);
    expect(() => applyRewriteEdits(raw, [edit('甲', '丙')], spans)).toThrow('歧义');
    expect(() => applyRewriteEdits(raw, [edit('甲甲', '丙'), edit('甲乙', '丁')], spans)).toThrow('重叠');
    expect(() => applyRewriteEdits('甲甲丁', [edit('甲甲丁', '丙')], spans)).toThrow('原文已变化');
    expect(() => applyRewriteEdits(raw, [], spans)).toThrow('协议');
    expect(() => applyRewriteEdits(raw, [edit(raw, raw)], spans)).toThrow('有效改动');
  });
  it('不能修改元数据或截断 Unicode 字符', () => {
    expect(() => rewriteSpans('title: 甲\n正文', [issue('title')], 9)).toThrow('frontmatter');
    const raw = '\uD83D\uDE00原文';
    expect(() => applyRewriteEdits(raw, [edit('\uD83D', '甲')], rewriteSpans(raw, [issue(raw)]))).toThrow('Unicode');
    expect(() => rewriteSpans('正文', [])).toThrow('请选择');
  });
  it('结构化输出有界且拒绝额外字段', () => {
    expect(validateOutput('rewrite-edits', [edit('甲', '乙')]).ok).toBe(true);
    expect(validateOutput('rewrite-edits', [{ ...edit('甲', '乙'), path: '正文.md' }]).ok).toBe(false);
    expect(validateOutput('rewrite-edits', []).ok).toBe(false);
    expect(
      validateOutput(
        'rewrite-edits',
        Array.from({ length: 101 }, () => edit('甲', '乙'))
      ).ok
    ).toBe(false);
  });
});
