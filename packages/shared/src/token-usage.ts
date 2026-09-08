import { Type, type Static } from 'typebox';

export const CacheTokenUsageSchema = Type.Object(
  {
    readTokens: Type.Optional(Type.Number({ minimum: 0 })),
    writeTokens: Type.Optional(Type.Number({ minimum: 0 })),
    uncachedTokens: Type.Optional(Type.Number({ minimum: 0 })),
    /** 汇总中有步骤未返回相同分项；数值仅为已报告部分。 */
    partial: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export const TokenUsageSchema = Type.Object(
  {
    inputTokens: Type.Number({ minimum: 0 }),
    outputTokens: Type.Number({ minimum: 0 }),
    totalTokens: Type.Optional(Type.Number({ minimum: 0 })),
    cache: Type.Optional(CacheTokenUsageSchema)
  },
  { additionalProperties: false }
);
export type CacheTokenUsage = Static<typeof CacheTokenUsageSchema>;
export type RecordedTokenUsage = Static<typeof TokenUsageSchema>;
export type TokenUsage = RecordedTokenUsage & { totalTokens: number };

const CACHE_FIELDS = ['readTokens', 'writeTokens', 'uncachedTokens'] as const;

/** 不用零补未知缓存分项；部分步骤缺指标时保留已报告数值并显式标记。 */
export function sumTokenUsage(items: readonly RecordedTokenUsage[]): TokenUsage {
  const result: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const item of items) {
    result.inputTokens += item.inputTokens;
    result.outputTokens += item.outputTokens;
    result.totalTokens += item.totalTokens ?? item.inputTokens + item.outputTokens;
  }
  const cache: CacheTokenUsage = {};
  let partial = items.some(item => item.cache?.partial === true);
  for (const field of CACHE_FIELDS) {
    const reported = items.flatMap(item => (item.cache?.[field] === undefined ? [] : [item.cache[field]!]));
    if (!reported.length) continue;
    cache[field] = reported.reduce((sum, tokens) => sum + tokens, 0);
    if (reported.length !== items.length) partial = true;
  }
  if (Object.keys(cache).length || partial) result.cache = { ...cache, ...(partial ? { partial: true } : {}) };
  return result;
}
