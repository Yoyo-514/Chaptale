import { clampCount, type SearchClient, type SearchResult, type WebSearcherOptions } from './search';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Brave Search API：独立索引、按次计费；需要订阅 token。 */
export function createBraveSearcher(client: SearchClient) {
  const doFetch = client.fetch ?? globalThis.fetch;

  return {
    async search({ query, maxResults, timeoutMs }: WebSearcherOptions): Promise<SearchResult[]> {
      const apiKey = client.keys.braveApiKey;

      if (!apiKey) {
        throw new Error('未配置 Brave API key；请在设置中填写或改用无需 key 的 duckduckgo');
      }

      const url = new URL(ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(clampCount(maxResults, 1, 20)));

      const response = await doFetch(url, {
        headers: { accept: 'application/json', 'x-subscription-token': apiKey },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Brave 搜索失败：HTTP ${response.status}`);
      }

      const data = (await response.json()) as { web?: { results?: BraveWebResult[] } };

      return (data.web?.results ?? []).slice(0, maxResults).map(item => ({
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: stripHtml(item.description ?? '')
      }));
    }
  };
}

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

/** Brave 描述字段可能内嵌 <b> 高亮标签，剥除后再返回。 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}
