import { describe, expect, it } from 'vitest';

import { extractContent } from '../fetch/extract';

const ARTICLE_HTML = `<!doctype html>
<html><head><title>页面标题</title></head><body>
<nav>导航 甲 乙 丙</nav>
<article>
  <p>第一段：鲁迅（1881-1936），浙江绍兴人，中国现代文学的奠基者。</p>
  <p>第二段：代表作有《呐喊》《彷徨》《朝花夕拾》等。</p>
</article>
<footer>页脚噪音 footer noise</footer>
</body></html>`;

describe('extractContent', () => {
  it('readability 命中：提取标题（<title> 优先）与正文段落', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/lu-xun', 'text/html');

    expect(result.title).toBe('页面标题');
    expect(result.markdown).toContain('第一段');
    expect(result.markdown).toContain('鲁迅');
    expect(result.markdown).not.toContain('页脚噪音');
    expect(result.wordCount).toBeGreaterThan(10);
  });

  it('markdown 输出保留正文段落结构', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/a', 'text/html');
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.text).not.toContain('页脚噪音');
  });

  it('JSON 输入原样返回', () => {
    const json = '{"data": [1, 2, 3]}';
    const result = extractContent(json, 'https://example.com/api', 'application/json');

    expect(result.markdown).toBe(json);
    expect(result.title).toBe('https://example.com/api');
  });

  it('空白/畸形 HTML 降级为纯文本', () => {
    const result = extractContent('<div>只有一段裸文本</div>', 'https://example.com/bare', 'text/html');

    expect(result.text).toContain('只有一段裸文本');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('wordCount 按中文逐字 + 英文分词混合计数', () => {
    const result = extractContent(
      '<article><p>hello world 你好世界</p></article>',
      'https://example.com/count',
      'text/html'
    );
    // 中文 4 字 + 英文 2 词（提取器可能保留全部内容，校验下界即可）。
    expect(result.wordCount).toBeGreaterThanOrEqual(6);
  });
});
