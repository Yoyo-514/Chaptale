import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';

const MARKED_CDN = 'https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js';
const DOMPURIFY_CDN = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return '';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function renderText(text: string) {
  return `<div class="message-text">${escapeHtml(text.trim())}</div>`;
}

/** 保留原始 Markdown 文本，交给页面里的 marked + DOMPurify 客户端渲染；CDN 不可用时按纯文本展示。 */
function renderMarkdownText(text: string) {
  return `<div class="message-text" data-markdown>${escapeHtml(text.trim())}</div>`;
}

function renderNotice(content: string) {
  return `<div class="notice">${escapeHtml(content)}</div>`;
}

function renderUserMessage(message: Extract<ChatMessage, { role: 'user' }>) {
  const blocks: string[] = [];
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
  const images =
    typeof message.content === 'string' ? [] : message.content.filter(block => block.type === 'imageAttachment');

  if (message.skillInvocation) {
    blocks.push(renderNotice(`Skill：<${message.skillInvocation.name}>`));
  }

  if (text.trim()) {
    blocks.push(renderText(text));
  }

  if (images.length > 0) {
    blocks.push(
      `<div class="attachments">${images
        .map(
          (image, index) =>
            `<figure><img src="${escapeHtml(image.thumbnailDataUrl)}" alt="附件图片 ${index + 1}"><figcaption>图片 ${index + 1}</figcaption></figure>`
        )
        .join('')}</div>`
    );
  }

  if (message.contextFiles?.length) {
    blocks.push(renderNotice(`附件：${message.contextFiles.map(file => file.path || file.name).join('、')}`));
  }

  return blocks;
}

function renderAssistantMessage(message: Extract<ChatMessage, { role: 'assistant' }>) {
  const blocks: string[] = [];
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  const toolCalls = message.content.filter(block => block.type === 'toolCall');

  if (text.trim()) {
    blocks.push(renderMarkdownText(text));
  }

  for (const toolCall of toolCalls) {
    blocks.push(
      `<details class="tool"><summary>调用工具 <code>${escapeHtml(toolCall.name)}</code></summary><pre>${escapeHtml(JSON.stringify(toolCall.arguments, null, 2))}</pre></details>`
    );
  }

  if (message.stopReason === 'aborted') {
    blocks.push(renderNotice('已手动停止，回复可能不完整'));
  } else if (message.stopReason === 'length') {
    blocks.push(renderNotice('达到输出长度上限，回复被截断'));
  }

  return blocks;
}

function renderToolResult(message: Extract<ChatMessage, { role: 'toolResult' }>) {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!text) {
    return [];
  }

  return [
    `<details class="tool"><summary>工具 <code>${escapeHtml(message.toolName)}</code> 结果</summary><pre>${escapeHtml(text)}</pre></details>`
  ];
}

function renderMessage(message: ChatMessage) {
  if (message.role === 'user') {
    return { role: '用户', blocks: renderUserMessage(message), timestamp: message.timestamp };
  }

  if (message.role === 'assistant') {
    return { role: '助手', blocks: renderAssistantMessage(message), timestamp: message.timestamp };
  }

  if (message.role === 'toolResult') {
    return { role: '', blocks: renderToolResult(message), timestamp: undefined };
  }

  return undefined;
}

const DOCUMENT_STYLES = `
:root { color-scheme: light dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #fcfcfd; color: #1f2328; font-size: 15px; line-height: 1.75; }
main { width: min(760px, calc(100% - 40px)); margin: 48px auto 64px; }
h1.doc-title { margin: 0 0 8px; font-size: 26px; line-height: 1.3; }
.doc-subtitle { margin: 0 0 40px; color: #667085; font-size: 13px; }
.entry { margin: 32px 0; }
.entry-header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; font-size: 12px; letter-spacing: 0.02em; }
.entry-header .role { font-weight: 650; color: #475467; }
.entry.user .entry-header .role { color: #1570cd; }
time { color: #98a2b3; font-size: 12px; }
.entry.user .entry-body { padding-left: 12px; border-left: 3px solid #b8d4f2; }
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.message-text.markdown-ready { white-space: normal; }
.notice { margin-top: 10px; padding: 6px 10px; border-left: 3px solid #98a2b3; color: #475467; font-size: 13px; }
.tool { margin: 10px 0; font-size: 13px; }
.tool summary { cursor: pointer; color: #667085; }
.tool summary:hover { color: #1f2328; }
.tool pre { max-height: 480px; margin: 6px 0 0; padding: 10px 12px; overflow: auto; border-radius: 8px; background: #f2f4f7; font: 12px/1.6 Consolas, monospace; }
.compaction { margin: 28px 0; padding: 10px 14px; border-left: 3px solid #9b8afb; color: #475467; font-size: 13px; white-space: pre-wrap; }
.attachments { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
figure { margin: 0; } figure img { display: block; max-width: 280px; max-height: 220px; border-radius: 8px; } figcaption { color: #98a2b3; font-size: 12px; }
code { padding: 1px 5px; border-radius: 4px; background: #f2f4f7; font-family: Consolas, monospace; font-size: 0.9em; }
pre code { padding: 0; background: none; }
.message-text h1, .message-text h2, .message-text h3, .message-text h4 { margin: 1.2em 0 0.5em; line-height: 1.35; }
.message-text h1 { font-size: 1.35em; } .message-text h2 { font-size: 1.22em; } .message-text h3 { font-size: 1.1em; } .message-text h4 { font-size: 1em; }
.message-text p { margin: 0.6em 0; }
.message-text ul, .message-text ol { margin: 0.6em 0; padding-left: 1.6em; }
.message-text li { margin: 0.25em 0; }
.message-text blockquote { margin: 0.8em 0; padding: 2px 14px; border-left: 3px solid #d0d5dd; color: #475467; }
.message-text pre { margin: 0.8em 0; padding: 12px 14px; overflow: auto; border-radius: 8px; background: #f2f4f7; font: 13px/1.6 Consolas, monospace; }
.message-text table { margin: 0.8em 0; border-collapse: collapse; font-size: 0.95em; }
.message-text th, .message-text td { padding: 6px 12px; border: 1px solid #d0d5dd; }
.message-text th { background: #f2f4f7; }
.message-text img { max-width: 100%; border-radius: 8px; }
.message-text hr { margin: 1.5em 0; border: 0; border-top: 1px solid #e4e7ec; }
.message-text a { color: #1570cd; }
@media (prefers-color-scheme: dark) {
  body { background: #101418; color: #e6edf3; }
  .doc-subtitle, .tool summary, .notice, .compaction { color: #adbac7; }
  .entry-header .role { color: #adbac7; }
  .entry.user .entry-header .role { color: #6cb2f5; }
  .entry.user .entry-body { border-left-color: #2c4a66; }
  .tool pre, .message-text pre, .message-text th, code { background: #1c2128; }
  .message-text blockquote { border-left-color: #444c56; color: #adbac7; }
  .message-text th, .message-text td { border-color: #373e47; }
  .message-text hr { border-top-color: #373e47; }
  .message-text a { color: #6cb2f5; }
}
@media print { body { background: #fff; } main { width: 100%; margin: 0; } .entry { break-inside: avoid; } }
`;

const MARKDOWN_BOOTSTRAP = `
(function () {
  function enhance() {
    if (!window.marked || !window.DOMPurify) { return; }
    window.marked.setOptions({ gfm: true, breaks: true });
    document.querySelectorAll('[data-markdown]').forEach(function (element) {
      element.innerHTML = window.DOMPurify.sanitize(window.marked.parse(element.textContent || ''));
      element.classList.add('markdown-ready');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
})();
`;

/** 把当前分支的会话条目渲染为可独立打开的单文件 HTML 文档。 */
export function buildSessionHtml(options: { name: string; entries: ChaptaleSessionTreeEntry[] }): string {
  const blocks: string[] = [];
  let messageCount = 0;

  for (const entry of options.entries) {
    if (entry.type === 'compaction') {
      blocks.push(
        `<aside class="compaction"><strong>历史摘要（压缩前 ${entry.tokensBefore} tokens）</strong>\n${escapeHtml(entry.summary)}</aside>`
      );
      continue;
    }

    if (entry.type !== 'message' && entry.type !== 'custom_message') {
      continue;
    }

    const rendered = renderMessage(entry.message);

    if (!rendered || rendered.blocks.length === 0) {
      continue;
    }

    if (!rendered.role) {
      blocks.push(rendered.blocks.join('\n'));
      continue;
    }

    messageCount += 1;
    const time = formatTimestamp(rendered.timestamp);
    blocks.push(
      `<article class="entry ${rendered.role === '用户' ? 'user' : 'assistant'}"><header class="entry-header"><span class="role">${rendered.role}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</header><div class="entry-body">${rendered.blocks.join('\n')}</div></article>`
    );
  }

  const title = escapeHtml(options.name);
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${DOCUMENT_STYLES}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1 class="doc-title">${title}</h1>`,
    `<p class="doc-subtitle">共 ${messageCount} 条消息 · 由 Chaptale 导出</p>`,
    blocks.join('\n'),
    '</main>',
    `<script src="${MARKED_CDN}"></script>`,
    `<script src="${DOMPURIFY_CDN}"></script>`,
    `<script>${MARKDOWN_BOOTSTRAP}</script>`,
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** Windows 文件名非法字符替换。 */
export function toSafeFileName(name: string) {
  const safe = name.replaceAll(/[\\/:*?"<>|\r\n]+/g, '-').trim();
  return (safe || '未命名会话').slice(0, 50);
}
