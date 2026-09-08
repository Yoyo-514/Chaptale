import { describe, expect, it } from 'vitest';

import { normalizeModelUsage } from '../token-usage';

describe('model cache usage', () => {
  it('OpenAI SDK 补的零不冒充 provider 已返回零', () => {
    expect(
      normalizeModelUsage({
        inputTokens: 100,
        outputTokens: 10,
        inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100 },
        raw: { input_tokens: 100, output_tokens: 10 }
      })
    ).toEqual({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
    expect(
      normalizeModelUsage({
        inputTokens: 100,
        outputTokens: 10,
        raw: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 } }
      }).cache
    ).toEqual({ readTokens: 0 });
  });

  it('区分 OpenAI 缓存读写与普通输入', () => {
    expect(
      normalizeModelUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        raw: { input_tokens: 1000, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 } }
      }).cache
    ).toEqual({ readTokens: 600, writeTokens: 300, uncachedTokens: 100 });
  });

  it('保留 Anthropic 原始分项，不重复累加已归一化的输入总数', () => {
    expect(
      normalizeModelUsage({
        inputTokens: 1000,
        outputTokens: 100,
        raw: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 }
      })
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cache: { readTokens: 600, writeTokens: 300, uncachedTokens: 100 }
    });
  });

  it('兼容 Chat Completions 和 DeepSeek 的已返回字段', () => {
    expect(
      normalizeModelUsage({
        inputTokens: 100,
        outputTokens: 10,
        raw: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 } }
      }).cache
    ).toEqual({ readTokens: 40 });
    expect(
      normalizeModelUsage({
        inputTokens: 100,
        outputTokens: 10,
        raw: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 }
      }).cache
    ).toEqual({ readTokens: 40, uncachedTokens: 60 });
  });

  it('其他协议保留 SDK 明确给出的分项，不将无效值当作命中', () => {
    expect(
      normalizeModelUsage({
        inputTokens: 100,
        outputTokens: 10,
        inputTokenDetails: { cacheReadTokens: 50 }
      }).cache
    ).toEqual({ readTokens: 50 });
    expect(
      normalizeModelUsage({
        inputTokens: Number.NaN,
        outputTokens: -2,
        inputTokenDetails: { cacheReadTokens: Number.POSITIVE_INFINITY, cacheWriteTokens: -1 }
      })
    ).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});
