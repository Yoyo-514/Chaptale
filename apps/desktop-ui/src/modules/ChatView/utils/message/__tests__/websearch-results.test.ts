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

  it('parses legacy JSON result arrays for backward compatibility', () => {
    const result = parseSearchResult(
      JSON.stringify([
        { title: 'Legacy', link: 'https://legacy.example', snippet: 'old result' },
        { title: 'Duplicate', url: 'https://legacy.example' }
      ])
    );

    expect(result.summary).toBe('');
    expect(result.citations).toEqual([{ title: 'Legacy', link: 'https://legacy.example', description: 'old result' }]);
  });

  it('parses full-result headings and background fetch status notes', () => {
    const result = parseSearchResult(`## Results for: "docs"

### Project Docs
https://docs.example.com/path),

---
Content fetching in background [fetch-1]. Will notify when ready.`);

    expect(result.queries).toEqual(['docs']);
    expect(result.citations).toEqual([{ title: 'Project Docs', link: 'https://docs.example.com/path' }]);
    expect(result.statusNotes).toEqual(['Content fetching in background [fetch-1]. Will notify when ready']);
  });

  it('ignores malformed JSON and empty source lists without throwing', () => {
    const result = parseSearchResult('{not json');

    expect(result.queries).toEqual([]);
    expect(result.citations).toEqual([]);
  });
});
