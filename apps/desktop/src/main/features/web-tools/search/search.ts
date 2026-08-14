import type { WebToolsProvider, WebToolsSettings } from '../settings';
import { createBraveSearcher } from './brave';
import { createDuckDuckGoSearcher } from './duckduckgo';
import { createExaSearcher } from './exa';
import { createTavilySearcher } from './tavily';

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearcherOptions = {
  /** 检索词。 */
  query: string;
  /** 期望结果数（1-10）。 */
  maxResults: number;
  /** 上游请求超时（毫秒）。 */
  timeoutMs: number;
};

export type SearchClient = {
  /** 测试注入用；缺省使用全局 fetch。 */
  fetch?: typeof globalThis.fetch;
  keys: WebToolsSettings['keys'];
};

/** 将请求条数收敛到 [min, max]；三个 key provider 共用的上限规则。 */
export function clampCount(count: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(count), min), max);
}

/**
 * 按 provider 分发检索；结果统一为 title/url/snippet 三元组。
 * provider 报错时直接上抛，由工具层转成面向模型的错误文本。
 */
export async function webSearch(
  provider: WebToolsProvider,
  client: SearchClient,
  options: WebSearcherOptions
): Promise<SearchResult[]> {
  const factory = SEARCHER_FACTORIES[provider];
  return factory(client).search(options);
}

const SEARCHER_FACTORIES: Record<
  WebToolsProvider,
  (client: SearchClient) => {
    search(options: WebSearcherOptions): Promise<SearchResult[]>;
  }
> = {
  duckduckgo: createDuckDuckGoSearcher,
  brave: createBraveSearcher,
  tavily: createTavilySearcher,
  exa: createExaSearcher
};

export { createBraveSearcher, createDuckDuckGoSearcher, createExaSearcher, createTavilySearcher };
