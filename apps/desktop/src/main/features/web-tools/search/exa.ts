import { clampCount, type SearchClient, type SearchResult, type WebSearcherOptions } from './search';

const ENDPOINT = 'https://api.exa.ai/search';

/** Exa：语义检索 API；对长查询与资料型检索效果较好。 */
export function createExaSearcher(client: SearchClient) {
  const doFetch = client.fetch ?? globalThis.fetch;

  return {
    async search({ query, maxResults, timeoutMs }: WebSearcherOptions): Promise<SearchResult[]> {
      const apiKey = client.keys.exaApiKey;

      if (!apiKey) {
        throw new Error('未配置 Exa API key；请在设置中填写或改用无需 key 的 duckduckgo');
      }

      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        // 只取标题与摘要片段，避免把正文预算浪费在搜索阶段。
        body: JSON.stringify({
          query,
          numResults: clampCount(maxResults, 1, 10),
          contents: { text: { maxCharacters: 400 } }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Exa 搜索失败：HTTP ${response.status}`);
      }

      const data = (await response.json()) as { results?: ExaResult[] };

      return (data.results ?? []).slice(0, maxResults).map(item => ({
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: (item.text ?? '').trim()
      }));
    }
  };
}

type ExaResult = {
  title?: string;
  url?: string;
  text?: string;
};
