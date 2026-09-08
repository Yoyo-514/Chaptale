import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import { TokenUsageSchema, sumTokenUsage } from '../token-usage';

describe('token usage', () => {
  it('兼容旧记录，不把缺失缓存指标补成零', () => {
    const old = { inputTokens: 10, outputTokens: 3 };
    expect(Compile(TokenUsageSchema).Check(old)).toBe(true);
    expect(sumTokenUsage([old])).toEqual({ ...old, totalTokens: 13 });
    expect(sumTokenUsage([])).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('累计已报告零值和完整缓存分项', () => {
    expect(
      sumTokenUsage([
        { inputTokens: 100, outputTokens: 20, cache: { readTokens: 0, writeTokens: 80, uncachedTokens: 20 } },
        { inputTokens: 100, outputTokens: 30, cache: { readTokens: 80, writeTokens: 0, uncachedTokens: 20 } }
      ])
    ).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      totalTokens: 250,
      cache: { readTokens: 80, writeTokens: 80, uncachedTokens: 40 }
    });
  });

  it('部分步骤缺少指标时保留已知数值并标记不完整', () => {
    const partial = sumTokenUsage([
      { inputTokens: 100, outputTokens: 20 },
      { inputTokens: 100, outputTokens: 30, cache: { readTokens: 0 } }
    ]);
    expect(partial.cache).toEqual({ readTokens: 0, partial: true });
    expect(sumTokenUsage([partial]).cache).toEqual(partial.cache);
    expect(
      sumTokenUsage([
        { inputTokens: 100, outputTokens: 20, cache: { readTokens: 60, writeTokens: 20 } },
        { inputTokens: 100, outputTokens: 30, cache: { readTokens: 80 } }
      ]).cache
    ).toEqual({ readTokens: 140, writeTokens: 20, partial: true });
  });

  it('拒绝负数与未知缓存字段', () => {
    const validator = Compile(TokenUsageSchema);
    expect(validator.Check({ inputTokens: 10, outputTokens: 1, cache: { readTokens: -1 } })).toBe(false);
    expect(validator.Check({ inputTokens: 10, outputTokens: 1, cache: { savedMoney: 10 } })).toBe(false);
  });
});
