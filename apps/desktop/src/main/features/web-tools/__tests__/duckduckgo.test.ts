import { describe, expect, it } from 'vitest';

import { parseDuckDuckGoHtml } from '../search/duckduckgo';

const SAMPLE_HTML = `
<html><body>
<div class="results">
  <div class="result results_links">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc">Example 文档</a>
    </h2>
    <a class="result__snippet" href="#">这是示例文档的<b>摘要</b>内容。</a>
  </div>
  <div class="result">
    <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fanother.org%2Fpage">另一个结果</a></h2>
    <a class="result__snippet">第二条结果的摘要。</a>
  </div>
  <div class="result">
    <h2><a class="result__a" href="https://direct.example.net/no-uddg">直链结果</a></h2>
    <a class="result__snippet">直链摘要。</a>
  </div>
  <div class="result">
    <h2><a class="result__a" href="javascript:alert(1)">坏协议丢弃</a></h2>
    <a class="result__snippet">应被过滤。</a>
  </div>
  <div class="result">
    <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fbad.example%2Ffile">非 http 目标</a></h2>
    <a class="result__snippet">uddg 解包后协议不合法，应被过滤。</a>
  </div>
</div>
</body></html>`;

describe('parseDuckDuckGoHtml', () => {
  it('提取结果并解包 uddg 重定向真实 URL', () => {
    const results = parseDuckDuckGoHtml(SAMPLE_HTML, 10);

    expect(results).toEqual([
      { title: 'Example 文档', url: 'https://example.com/docs', snippet: '这是示例文档的摘要内容。' },
      { title: '另一个结果', url: 'https://another.org/page', snippet: '第二条结果的摘要。' },
      { title: '直链结果', url: 'https://direct.example.net/no-uddg', snippet: '直链摘要。' }
    ]);
  });

  it('按 maxResults 截取前 N 条', () => {
    const results = parseDuckDuckGoHtml(SAMPLE_HTML, 2);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Example 文档');
  });

  it('过滤坏协议与非 http 目标链接', () => {
    const results = parseDuckDuckGoHtml(SAMPLE_HTML, 10);
    expect(results.some(result => result.url.startsWith('javascript:'))).toBe(false);
    expect(results.some(result => result.url.startsWith('ftp:'))).toBe(false);
  });

  it('结构变化（无匹配节点）返回空数组', () => {
    expect(parseDuckDuckGoHtml('<html><body>upstream redesigned</body></html>', 5)).toEqual([]);
  });

  it('snippet 高亮标签被剥除', () => {
    const results = parseDuckDuckGoHtml(SAMPLE_HTML, 1);
    expect(results[0].snippet).not.toContain('<b>');
  });
});
