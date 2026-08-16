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
/** 缓存按总字符数设限（源串 + HTML 双份），避免长会话内存膨胀。 */
const MAX_CACHE_CHARS = 2 * 1024 * 1024;
let cachedChars = 0;

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

  // 超长内容不入缓存（单条已接近预算）；常规内容入缓存并按总字符数淘汰最旧条目。
  if (content.length + html.length < MAX_CACHE_CHARS) {
    markdownCache.set(content, html);
    cachedChars += content.length + html.length;

    while (cachedChars > MAX_CACHE_CHARS && markdownCache.size > 0) {
      const [firstKey] = markdownCache.keys();
      const evicted = markdownCache.get(firstKey);

      if (evicted !== undefined) {
        cachedChars -= firstKey.length + evicted.length;
      }

      markdownCache.delete(firstKey);
    }
  }

  return html;
}

export function renderMarked(content: string) {
  return marked.parse(content) as Exclude<MarkedParseResult, Promise<string>>;
}
