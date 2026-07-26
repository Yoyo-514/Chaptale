import { describe, expect, it } from 'vitest';

import { clearStreamingMarkdownCache, renderMarkdown, renderStreamingMarkdown } from '..';

describe('markdown-renderer', () => {
  it('temporarily closes open fence blocks while streaming', () => {
    const html = renderStreamingMarkdown('open-fence', '```ts\nconst value = 1;');

    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const value = 1;');

    clearStreamingMarkdownCache('open-fence');
  });

  it('escapes raw HTML instead of rendering it', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('drops javascript: and other dangerous link protocols but keeps safe ones', () => {
    expect(renderMarkdown('[点我](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderMarkdown('[点我](javascript:alert(1))')).toContain('点我');
    expect(renderMarkdown('[文档](https://example.com/docs)')).toContain('href="https://example.com/docs"');
    expect(renderMarkdown('[邮件](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
  });

  it('rejects non-image data urls and dangerous image sources', () => {
    expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderMarkdown('![x](data:text/html,<script>alert(1)</script>)')).not.toContain('data:text/html');
    expect(renderMarkdown('![x](data:image/png;base64,AAAA)')).toContain('src="data:image/png;base64,AAAA"');
    expect(renderMarkdown('![x](https://a.test/x.png)')).toContain('src="https://a.test/x.png"');
  });

  it('wraps tables with the custom table wrapper', () => {
    expect(renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |')).toContain('<div class="markdown-table-wrapper"><table>');
  });

  it('renders completed markdown with the normal renderer after streaming cache is cleared', () => {
    const messageId = 'completed-message';
    renderStreamingMarkdown(messageId, '第一段\n\n```ts\nconst value = 1;\n```\n');
    clearStreamingMarkdownCache(messageId);

    expect(renderMarkdown('第一段\n\n```ts\nconst value = 1;\n```\n')).toContain('<pre><code class="language-ts">');
  });
});
