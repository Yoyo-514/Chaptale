import { parseBingRssResults } from './bing-rss.parser';
import type { WebsearchArgs, WebsearchResultItem } from './websearch.types';

/**
 * 联网搜索函数。
 *
 * 使用 Bing 的 RSS 响应接口，进行简单的正则提取。
 */
export async function websearch(args: WebsearchArgs, signal?: AbortSignal): Promise<WebsearchResultItem[]> {
  const { keywords } = args;
  const requestInit = signal ? { signal } : undefined;

  const res = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(keywords)}`, requestInit);
  const rss = await res.text();

  return parseBingRssResults(rss);
}
