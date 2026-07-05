import MarkdownIt from 'markdown-it';

export const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

markdown.renderer.rules.table_open = (tokens, idx, options, _env, self) => {
  return `<div class="markdown-table-wrapper">${self.renderToken(tokens, idx, options)}`;
};

markdown.renderer.rules.table_close = (tokens, idx, options, _env, self) => {
  return `${self.renderToken(tokens, idx, options)}</div>`;
};

const markdownCache = new Map<string, string>();
const MAX_CACHE_SIZE = 300;

export function renderMarkdown(content: string) {
  const cached = markdownCache.get(content);

  if (cached !== undefined) {
    return cached;
  }

  const html = markdown.render(content);
  markdownCache.set(content, html);

  if (markdownCache.size > MAX_CACHE_SIZE) {
    const [firstKey] = markdownCache.keys();
    markdownCache.delete(firstKey);
  }

  return html;
}
