import { escapeAttribute, escapeHtml } from './escape';
import { renderMarked } from './markdown';
import { parseFence, type FenceMarker } from './scanner';

const LONG_OPEN_FENCE_THRESHOLD = 4000;

type OpenFenceInfo = {
  isOpen: boolean;
  marker: FenceMarker;
  length: number;
  openerLine: string;
};

/**
 * 渲染尚不稳定的流式尾部。
 * 短尾部临时补齐开放代码围栏与奇数个未转义反引号后交给 marked；
 * 超长开放代码围栏直接按转义后的 `<pre><code>` 输出，避免反复解析整段代码。
 */
export function renderStreamingTail(tail: string) {
  if (!tail) {
    return '';
  }

  const fenceInfo = getOpenFenceInfo(tail);

  if (fenceInfo.isOpen && tail.length > LONG_OPEN_FENCE_THRESHOLD) {
    return renderLongOpenFenceTail(tail, fenceInfo);
  }

  return renderMarked(closeOpenMarkdownTail(tail, fenceInfo));
}

/** 只为本次渲染补齐语法，不修改缓存中的原始 Markdown。 */
function closeOpenMarkdownTail(tail: string, fenceInfo = getOpenFenceInfo(tail)) {
  let normalizedTail = tail;

  if (fenceInfo.isOpen) {
    normalizedTail += `\n${fenceInfo.marker.repeat(fenceInfo.length)}\n`;
  }

  // 行内代码不闭合时 marked 会把反引号当普通文本；临时闭合可减少流式抖动。
  if (countUnescapedBackticks(normalizedTail) % 2 === 1) {
    normalizedTail += '`';
  }

  return normalizedTail;
}

function getOpenFenceInfo(content: string): OpenFenceInfo {
  let isOpen = false;
  let marker: FenceMarker = '`';
  let length = 3;
  let openerLine = '';

  for (const line of content.split('\n')) {
    const fence = parseFence(line);

    if (!fence) {
      continue;
    }

    if (!isOpen) {
      isOpen = true;
      marker = fence.marker;
      length = fence.length;
      openerLine = line;
      continue;
    }

    if (fence.marker === marker && fence.length >= length) {
      isOpen = false;
      openerLine = '';
    }
  }

  return { isOpen, marker, length, openerLine };
}

function renderLongOpenFenceTail(tail: string, fenceInfo: OpenFenceInfo) {
  const lines = tail.split('\n');
  const openerIndex = lines.findIndex(line => line === fenceInfo.openerLine);

  if (openerIndex === -1) {
    return renderMarked(closeOpenMarkdownTail(tail, fenceInfo));
  }

  const beforeFence = lines.slice(0, openerIndex).join('\n');
  const code = lines.slice(openerIndex + 1).join('\n');
  const language = getFenceLanguage(fenceInfo.openerLine);
  const beforeHtml = beforeFence ? renderMarked(beforeFence) : '';
  const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : '';

  return `${beforeHtml}<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`;
}

function getFenceLanguage(openerLine: string) {
  return (
    openerLine
      .replace(/^\s*(`{3,}|~{3,})/, '')
      .trim()
      .split(/\s+/)[0] ?? ''
  );
}

function countUnescapedBackticks(content: string) {
  let count = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '`') {
      continue;
    }

    if (index > 0 && content[index - 1] === '\\') {
      continue;
    }

    count += 1;
  }

  return count;
}
