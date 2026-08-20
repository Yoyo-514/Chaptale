import { describe, expect, it } from 'vitest';

import {
  estimateTextTokens,
  fitTextToTokens,
  isTextWithinTokenLimit,
  takeTextTailToTokenBudget,
  takeTextToTokenBudget
} from '../token-counter';

describe('token-counter', () => {
  it('ASCII 按四字符约一 token 估算', () => {
    expect(estimateTextTokens('12345678')).toBe(2);
    expect(estimateTextTokens('12345')).toBe(2);
    expect(estimateTextTokens('')).toBe(0);
  });

  it('非 ASCII 字符按一字符约一 token 保守估算', () => {
    expect(estimateTextTokens('中'.repeat(4_000))).toBe(4_000);
    expect(estimateTextTokens('中文abcd')).toBe(3);
  });

  it('checks inclusive token limits', () => {
    expect(isTextWithinTokenLimit('12345678', 2)).toBe(true);
    expect(isTextWithinTokenLimit('123456789', 2)).toBe(false);
  });

  it('超预算时保留首尾并插入明确省略标记', () => {
    const text = `开头证据-${'中'.repeat(8_000)}-结尾证据`;
    const fitted = fitTextToTokens(text, 1_000);

    expect(estimateTextTokens(fitted)).toBeLessThanOrEqual(1_000);
    expect(fitted).toContain('开头证据');
    expect(fitted).toContain('结尾证据');
    expect(fitted).toContain('已按 token 预算省略内容');
  });

  it('未超预算时保持原文逐字不变', () => {
    expect(fitTextToTokens('短文本 abc', 100)).toBe('短文本 abc');
  });

  it('headRatio 控制首尾比例，omitMarker 可定制', () => {
    const text = `${'a'.repeat(4_000)}${'中'.repeat(50)}`; // 1000 + 50 tokens

    // headRatio=0：预算全给尾部，首部不保留。
    const tailOnly = fitTextToTokens(text, 60, { headRatio: 0 });
    expect(tailOnly).not.toContain('aaaa');
    expect(tailOnly).toContain('中');

    // 自定义省略标记替换默认文案。
    const marked = fitTextToTokens(text, 60, { omitMarker: '…中间略…' });
    expect(marked).toContain('…中间略…');
    expect(marked).not.toContain('已按 token 预算省略内容');
  });

  it('按预算无损连续切片且不拆分代理对', () => {
    const input = '林晚🙂abcdef机械师';
    const parts: string[] = [];
    let rest = input;

    while (rest) {
      const slice = takeTextToTokenBudget(rest, 3);
      expect(estimateTextTokens(slice.head)).toBeLessThanOrEqual(3);
      expect(slice.head.length).toBeGreaterThan(0);
      expect(slice.head.endsWith('\ud83d')).toBe(false);
      expect(slice.rest.startsWith('\ude42')).toBe(false);
      parts.push(slice.head);
      rest = slice.rest;
    }

    expect(parts.join('')).toBe(input);
  });

  it('零预算不消费原文', () => {
    expect(takeTextToTokenBudget('正文', 0)).toEqual({ head: '', rest: '正文' });
  });

  it('从尾部取预算时不拆分代理对', () => {
    const result = takeTextTailToTokenBudget('前文abcdef🙂林晚', 3);

    expect(estimateTextTokens(result.tail)).toBeLessThanOrEqual(3);
    expect(result.head + result.tail).toBe('前文abcdef🙂林晚');
    expect(result.head.endsWith('\ud83d')).toBe(false);
    expect(result.tail.startsWith('\ude42')).toBe(false);
  });
});
