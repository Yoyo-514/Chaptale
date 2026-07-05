import { escapeHtml } from './escape';
import { markdown } from './markdown';
import { getFullLineEnd, scanStableOffset } from './scanner';
import { renderStreamingTail } from './tail';

const streamingCache = new Map<string, StreamingMarkdownCache>();

type StreamingMarkdownCache = {
  stableOffset: number;
  stableHtml: string;
  lastContent: string;
};

/**
 * 流式 Markdown 增量渲染。
 *
 * markdown-it 不是增量 parser；这里在外层维护 stableOffset：
 * - 只扫描完整行，最后一行永远留在 unstable tail；
 * - 从上次 stableOffset 继续扫描，避免每次全文扫描；
 * - scanner 维护 fence/table/list/blockquote 等块状态；
 * - 提交时保留最近 1~2 个 block 在 tail，牺牲少量重复解析换稳定性；
 * - stable 区 HTML 缓存，tail 区使用 markdown-it 重算。
 */
export function renderStreamingMarkdown(messageId: string, content: string) {
  const previous = streamingCache.get(messageId);
  const cache = previous && content.startsWith(previous.lastContent) ? previous : createEmptyStreamingCache();
  const fullLineEnd = getFullLineEnd(content);
  const nextStableOffset = Math.max(cache.stableOffset, scanStableOffset(content, cache.stableOffset, fullLineEnd));
  let stableHtml = cache.stableHtml;

  if (nextStableOffset > cache.stableOffset) {
    stableHtml += markdown.render(content.slice(cache.stableOffset, nextStableOffset));
  }

  const tail = content.slice(nextStableOffset);
  const tailHtml = renderStreamingTail(tail);

  streamingCache.set(messageId, {
    stableOffset: nextStableOffset,
    stableHtml,
    lastContent: content
  });

  return stableHtml + tailHtml;
}

export function clearStreamingMarkdownCache(messageId: string) {
  streamingCache.delete(messageId);
}

/** 保留给极端 fallback：纯文本流式渲染。 */
export function renderStreamingText(content: string) {
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function createEmptyStreamingCache(): StreamingMarkdownCache {
  return {
    stableOffset: 0,
    stableHtml: '',
    lastContent: ''
  };
}
