import { clampCount, type SearchClient, type SearchResult, type WebSearcherOptions } from './search';

const ENDPOINT = 'https://api.tavily.com/search';

/** Tavily：面向 LLM 的搜索 API；返回已提炼的摘要，无需二次抽取。 */
export function createTavilySearcher(client: SearchClient) {
  const doFetch = client.fetch ?? globalThis.fetch;

  return {
    async search({ query, maxResults, timeoutMs }: WebSearcherOptions): Promise<SearchResult[]> {
      const apiKey = client.keys.tavilyApiKey;

      if (!apiKey) {
        throw new Error('未配置 Tavily API key；请在设置中填写或改用无需 key 的 duckduckgo');
      }

      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: clampCount(maxResults, 1, 10) }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Tavily 搜索失败：HTTP ${response.status}`);
      }

      const data = (await response.json()) as { results?: TavilyResult[] };

      return (data.results ?? []).slice(0, maxResults).map(item => ({
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: (item.content ?? '').trim()
      }));
    }
  };
}

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};
