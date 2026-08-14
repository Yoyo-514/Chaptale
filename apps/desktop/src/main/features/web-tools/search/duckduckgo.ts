import { parseHTML } from 'linkedom';

import type { SearchResult, SearchClient, WebSearcherOptions } from './search';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const UA = 'Mozilla/5.0 (compatible; ChaptaleWebTools/1.0)';

/**
 * DuckDuckGo Lite/HTML 端点检索：无需 API key，作为零配置默认搜索。
 *
 * 上游为无契约 HTML 页面，结构变化时由解析层兜底（result__a 链接 + result__snippet）；
 * uddg 重定向参数里的真实 URL 需要解包。
 */
export function createDuckDuckGoSearcher(client: SearchClient) {
  const doFetch = client.fetch ?? globalThis.fetch;

  return {
    async search({ query, maxResults, timeoutMs }: WebSearcherOptions): Promise<SearchResult[]> {
      const body = new URLSearchParams({ q: query });
      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo 搜索失败：HTTP ${response.status}`);
      }

      return parseDuckDuckGoHtml(await response.text(), maxResults);
    }
  };
}

/** 解析结果页并截取前 maxResults 条；解析不到任何结果时抛错，便于上层诊断结构变化。 */
export function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const { document } = parseHTML(html);
  const results: SearchResult[] = [];

  for (const anchor of document.querySelectorAll('a.result__a')) {
    if (results.length >= maxResults) {
      break;
    }

    const title = anchor.textContent?.trim() ?? '';
    const href = anchor.getAttribute('href') ?? '';
    const url = extractRealUrl(href);

    if (!title || !url) {
      continue;
    }

    const container = anchor.closest('.result');
    const snippet = container?.querySelector('.result__snippet')?.textContent?.trim() ?? '';

    results.push({ title, url, snippet });
  }

  return results;
}

/** DDG 链接形如 //duckduckgo.com/l/?uddg=<encoded>；解包失败时按相对链接丢弃。 */
function extractRealUrl(href: string): string {
  if (!href) {
    return '';
  }

  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');

    if (target) {
      const decoded = new URL(target);
      return decoded.protocol === 'http:' || decoded.protocol === 'https:' ? decoded.toString() : '';
    }

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
