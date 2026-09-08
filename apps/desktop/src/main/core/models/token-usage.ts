import type { TokenUsage, CacheTokenUsage } from '@chaptale/shared';

type ModelUsageInput = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  raw?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** SDK 会把若干未返回的缓存指标补成零，已知协议须回查原始 usage。 */
export function normalizeModelUsage(usage: ModelUsageInput): TokenUsage {
  const inputTokens = count(usage.inputTokens) ?? 0;
  const outputTokens = count(usage.outputTokens) ?? 0;
  const result: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: count(usage.totalTokens) ?? inputTokens + outputTokens
  };
  const raw = object(usage.raw);
  let readTokens: number | undefined;
  let writeTokens: number | undefined;
  let uncachedTokens: number | undefined;

  if ('cache_read_input_tokens' in raw || 'cache_creation_input_tokens' in raw) {
    readTokens = count(raw.cache_read_input_tokens);
    writeTokens = count(raw.cache_creation_input_tokens);
    uncachedTokens = count(raw.input_tokens);
  } else if ('input_tokens' in raw || 'prompt_tokens' in raw) {
    const details = object(raw.input_tokens_details ?? raw.prompt_tokens_details);
    readTokens = count(details.cached_tokens ?? raw.prompt_cache_hit_tokens);
    writeTokens = count(details.cache_write_tokens);
    // 缺少写入分项时不猜它为零，也不把潜在写入量归为普通输入。
    if (readTokens !== undefined && writeTokens !== undefined && readTokens + writeTokens <= inputTokens) {
      uncachedTokens = inputTokens - readTokens - writeTokens;
    } else {
      uncachedTokens = count(raw.prompt_cache_miss_tokens);
    }
  } else {
    readTokens = count(usage.inputTokenDetails?.cacheReadTokens);
    writeTokens = count(usage.inputTokenDetails?.cacheWriteTokens);
    uncachedTokens = count(usage.inputTokenDetails?.noCacheTokens);
  }

  const cache: CacheTokenUsage = {
    ...(readTokens !== undefined ? { readTokens } : {}),
    ...(writeTokens !== undefined ? { writeTokens } : {}),
    ...(uncachedTokens !== undefined ? { uncachedTokens } : {})
  };
  if (Object.keys(cache).length) result.cache = cache;
  return result;
}
