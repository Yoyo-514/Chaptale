import type { ChaptaleCustomProviderApi } from '@chaptale/ipc-contract';

export function normalizeCustomProviderApi(api: string): ChaptaleCustomProviderApi {
  if (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'anthropic-messages' ||
    api === 'google-generative-ai'
  ) {
    return api;
  }

  throw new Error(`不支持的 API 类型：${api}`);
}

export function normalizeModelInput(input: unknown): ('text' | 'image')[] {
  if (!Array.isArray(input)) {
    return ['text'];
  }

  const normalized = input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image');

  if (!normalized.includes('text')) {
    normalized.unshift('text');
  }

  return [...new Set(normalized)];
}

export function normalizeProviderId(provider: string) {
  const normalized = provider.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error('供应商 ID 只能包含字母、数字、点、下划线和短横线');
  }

  return normalized;
}

export function getModelKey(provider: string, modelId: string) {
  return `${provider}:${modelId}`;
}

export function validateContextWindow(contextWindow?: number) {
  if (contextWindow !== undefined && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
    throw new Error('Context Window 必须是大于 0 的数字');
  }
}

export function toOptionalContextWindow(contextWindow?: number) {
  return contextWindow ? Math.trunc(contextWindow) : undefined;
}
