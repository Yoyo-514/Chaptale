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
