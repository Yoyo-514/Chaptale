import { marked, Renderer } from 'marked';

import { escapeHtml } from './escape';

/**
 * 输出安全策略：raw HTML 块/内联 HTML 全部转义（见 renderer.html），因此注入面只剩
 * marked 自己为链接/图片生成的 href/src。这里用协议白名单封堵 javascript: 等危险协议。
 * 不用 DOMPurify：它依赖真实 DOM，在 happy-dom 测试环境行为不可靠（会误删合法节点）。
 */
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'data:']);

const renderer = new Renderer();

renderer.html = token => escapeHtml(token.raw);

const renderTable = renderer.table.bind(renderer);
renderer.table = token => `<div class="markdown-table-wrapper">${renderTable(token)}</div>`;

const renderLink = renderer.link.bind(renderer);
renderer.link = token => (isSafeUrl(token.href, SAFE_LINK_PROTOCOLS) ? renderLink(token) : escapeHtml(token.text));

const renderImage = renderer.image.bind(renderer);
renderer.image = token =>
  isSafeUrl(token.href, SAFE_IMAGE_PROTOCOLS) && !/^data:(?!image\/)/i.test(token.href.trim())
    ? renderImage(token)
    : escapeHtml(token.text || '');

function isSafeUrl(href: string, protocols: Set<string>) {
  try {
    return protocols.has(new URL(href, 'https://chaptale.invalid').protocol);
  } catch {
    return false;
  }
}

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
