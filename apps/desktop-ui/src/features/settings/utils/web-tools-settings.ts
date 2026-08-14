import type { WebToolsProvider, WebToolsSettings } from '@chaptale/ipc-contract';

export type WebToolsOption<T extends string> = {
  value: T;
  label: string;
  note: string;
};

export const webToolsProviders: WebToolsOption<WebToolsProvider>[] = [
  { value: 'duckduckgo', label: 'DuckDuckGo', note: '无需 API Key，零配置默认' },
  { value: 'brave', label: 'Brave', note: '需要 Brave Search API Key' },
  { value: 'tavily', label: 'Tavily', note: '需要 Tavily API Key，面向 LLM' },
  { value: 'exa', label: 'Exa', note: '需要 Exa API Key，语义检索' }
];

export function createDefaultWebToolsSettings(): WebToolsSettings {
  return {
    search: { enabled: true, provider: 'duckduckgo' },
    keys: {},
    fetch: { timeoutSeconds: 30, maxBytes: 2 * 1024 * 1024 },
    ssrf: { allowRanges: [] }
  };
}

/** 把后端快照补齐为可编辑表单对象；嵌套分组逐层合并，容忍旧配置缺字段。 */
export function normalizeWebToolsSettings(value: WebToolsSettings | undefined): WebToolsSettings {
  const fallback = createDefaultWebToolsSettings();
  const source = value ?? fallback;

  return {
    search: { ...fallback.search, ...source.search },
    keys: { ...fallback.keys, ...source.keys },
    fetch: { ...fallback.fetch, ...source.fetch },
    ssrf: {
      allowRanges: Array.isArray(source.ssrf?.allowRanges) ? source.ssrf.allowRanges : []
    }
  };
}
