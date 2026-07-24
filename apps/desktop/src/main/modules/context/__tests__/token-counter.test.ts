import { describe, expect, it } from 'vitest';

import { estimateTextTokens, fitTextToTokens, isTextWithinTokenLimit } from '../token-counter';

describe('token-counter', () => {
  it('沿用 pi 的 ASCII 四字符约一 token 估算', () => {
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
});
