import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

type WebsearchArgs = {
  keywords: string;
};

export class ToolsService {
  readonly tools: ToolSet = {
    websearch: tool({
      description: '通过网络搜索获取信息',
      inputSchema: z.object({
        keywords: z
          .string()
          .describe(
            '搜索查询字符串。可以是简单关键词组合，也可以使用 Bing 搜索运算符构造精确查询。例如："rust programming" +cargo，或 "machine learning" +python +tutorial'
          )
      }),
      execute: args => this.websearch(args)
    })
  };

  /**
   * 联网搜索函数。
   *
   * 使用 Bing 的 RSS 响应接口，进行简单的正则提取。
   */
  async websearch(args: WebsearchArgs) {
    const { keywords } = args;

    const res = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(keywords)}`);
    const rss = await res.text();
    const matches = rss.match(/<item>([\s\S]*?)<\/item>/g);

    if (!matches) {
      return [];
    }

    const results = matches.map(match => {
      const title = match.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const link = match.match(/<link>([\s\S]*?)<\/link>/)?.[1];
      const description = match.match(/<description>([\s\S]*?)<\/description>/)?.[1];

      if (!title || !link) {
        return null;
      }

      return { title, link, description };
    });

    return results.filter(result => result !== null);
  }
}
