import { marked, Renderer } from 'marked';

import { escapeHtml } from './escape';

const renderer = new Renderer();

renderer.html = token => escapeHtml(token.raw);

const renderTable = renderer.table.bind(renderer);
renderer.table = token => `<div class="markdown-table-wrapper">${renderTable(token)}</div>`;

type MarkedParseResult = string | Promise<string>;

const markdownCache = new Map<string, string>();
const MAX_CACHE_SIZE = 300;

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
  renderer
});

export function renderMarkdown(content: string) {
  const cached = markdownCache.get(content);

  if (cached !== undefined) {
    return cached;
  }

  const html = renderMarked(content);
  markdownCache.set(content, html);

  if (markdownCache.size > MAX_CACHE_SIZE) {
    const [firstKey] = markdownCache.keys();
    markdownCache.delete(firstKey);
  }

  return html;
}

export function renderMarked(content: string) {
  return marked.parse(content) as Exclude<MarkedParseResult, Promise<string>>;
}
