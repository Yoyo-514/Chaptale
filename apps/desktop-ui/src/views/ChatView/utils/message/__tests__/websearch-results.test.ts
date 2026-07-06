import { describe, expect, it } from 'vitest';

import { parseSearchResult } from '../websearch-results';

describe('websearch-results', () => {
  it('parses pi web access markdown with query, summary, and sources', () => {
    const result = parseSearchResult(`## Query: "AC 自动机"

AC 自动机常用于多模式字符串匹配。

---

**Sources:**
1. AC 自动机算法 - 维基百科
   https://zh.wikipedia.org/wiki/Aho%E2%80%93Corasick%E7%AE%97%E6%B3%95

2. YiteAI 工具箱
   https://tools.yiteai.com/ac-automaton
`);

    expect(result.queries).toEqual(['AC 自动机']);
    expect(result.summary).toContain('AC 自动机常用于多模式字符串匹配');
    expect(result.citations).toEqual([
      {
        title: 'AC 自动机算法 - 维基百科',
        link: 'https://zh.wikipedia.org/wiki/Aho%E2%80%93Corasick%E7%AE%97%E6%B3%95'
      },
      {
        title: 'YiteAI 工具箱',
        link: 'https://tools.yiteai.com/ac-automaton'
      }
    ]);
  });

  it('parses markdown link sources', () => {
    const result = parseSearchResult('**Sources:**\n\n1. [Example](https://example.com/path)');

    expect(result.citations).toEqual([{ title: 'Example', link: 'https://example.com/path' }]);
  });
});
