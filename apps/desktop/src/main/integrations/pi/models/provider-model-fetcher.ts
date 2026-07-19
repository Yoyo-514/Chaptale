import type { ChaptaleCustomProviderApi, FetchCustomProviderModelsResult } from '@chaptale/ipc-contract';
import { isRecord, readString, stripTrailingSlashes } from '@chaptale/shared';

export type FetchModelsSource = {
  baseUrl: string;
  api: ChaptaleCustomProviderApi;
  apiKey?: string;
};

/**
 * 从兼容 OpenAI 或 Google 的供应商端点拉取模型清单。
 * 不同 API 的认证位置在此统一，Anthropic 因没有通用列表接口而明确拒绝自动发现。
 */
export async function fetchProviderModels(source: FetchModelsSource): Promise<FetchCustomProviderModelsResult> {
  const apiKey = source.apiKey?.trim();

  if (!apiKey) {
    throw new Error('请先填写模型 Key，再拉取模型列表');
  }

  if (source.api === 'anthropic-messages') {
    throw new Error('当前 API 类型没有通用模型列表接口');
  }

  const url = createModelsUrl(source.baseUrl, source.api, apiKey);
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (apiKey && source.api !== 'google-generative-ai') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (apiKey && source.api === 'google-generative-ai') {
    headers['x-goog-api-key'] = apiKey;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`模型列表请求失败：HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return { models: parseFetchedModels(data, source.api) };
}

export function createModelsUrl(baseUrl: string, api: ChaptaleCustomProviderApi, apiKey?: string) {
  const url = new URL(`${stripTrailingSlashes(baseUrl)}/models`);

  // Google Generative AI 的公开列表接口常见用法是 key query；同时服务层也会带 x-goog-api-key header。
  if (api === 'google-generative-ai' && apiKey) {
    url.searchParams.set('key', apiKey);
  }

  return url;
}

/**
 * 兼容 `{ data: [...] }` 与 `{ models: [...] }` 两类响应，并把 Google 的 `models/` 资源前缀移出应用模型 ID。
 */
export function parseFetchedModels(data: unknown, api: ChaptaleCustomProviderApi) {
  const record = isRecord(data) ? data : {};
  const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];

  return rawModels
    .map(item => {
      if (!isRecord(item)) {
        return undefined;
      }

      const rawName = readString(item.name);
      const displayName = readString(item.displayName);
      const rawId = readString(item.id) ?? rawName ?? '';
      const id = api === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId;
      const name = rawName && rawName !== rawId ? rawName : (displayName ?? id);

      return id ? { id, name } : undefined;
    })
    .filter((model): model is { id: string; name: string } => model !== undefined);
}
