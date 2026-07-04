import { Type } from 'typebox';

import type { ChaptaleToolDefinition } from '../core/chaptale-tool';
import { websearch } from './websearch.service';

const websearchParameters = Type.Object({
  keywords: Type.String({
    description:
      '搜索查询字符串。可以是简单关键词组合，也可以使用 Bing 搜索运算符构造精确查询。例如："rust programming" +cargo'
  })
});

export const websearchTool: ChaptaleToolDefinition<typeof websearchParameters> = {
  name: 'websearch',
  label: '联网搜索',
  description: '通过网络搜索获取信息',
  parameters: websearchParameters,
  async execute(params, signal) {
    const results = await websearch({ keywords: (params as { keywords: string }).keywords }, signal);
    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
      details: results
    };
  }
};
