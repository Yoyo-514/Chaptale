import { tool } from 'ai';
import { z } from 'zod';

type WebsearchArgs = {
  keywords: string;
};

/**
 * 联网搜索函数。
 *
 * 使用 Bing 的 RSS 响应接口，进行简单的正则提取。
 */
export async function websearch(args: WebsearchArgs) {
  const { keywords } = args;

  const res = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(keywords)}`);
  const rss = await res.text();
  const matches = rss.match(/<item>(.*?)<\/item>/g);

  if (!matches) {
    return [];
  }

  const results = matches.map(match => {
    const title = match.match(/<title>(.*?)<\/title>/)?.[1];
    const link = match.match(/<link>(.*?)<\/link>/)?.[1];
    const description = match.match(/<description>(.*?)<\/description>/)?.[1];

    if (!title || !link) {
      return null;
    }

    return { title, link, description };
  });

  return results.filter(result => result !== null);
}

export const tools = {
  websearch: tool({
    description: '通过网络搜索获取信息',
    inputSchema: z.object({
      keywords: z
        .string()
        .describe(
          '搜索查询字符串。可以是简单关键词组合，也可以使用 Bing 搜索运算符构造精确查询。例如："rust programming" +cargo，或 "machine learning" +python +tutorial'
        )
    }),
    execute: websearch
  })
};
