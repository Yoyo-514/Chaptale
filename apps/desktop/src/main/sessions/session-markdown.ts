import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';

const CODE_FENCE = '````';

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

function getUserSections(message: Extract<ChatMessage, { role: 'user' }>) {
  const sections: string[] = [];
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
  const imageCount =
    typeof message.content === 'string' ? 0 : message.content.filter(block => block.type === 'imageAttachment').length;

  if (text.trim()) {
    sections.push(text.trim());
  }

  if (imageCount > 0) {
    sections.push(`> 附带 ${imageCount} 张图片`);
  }

  if (message.contextFiles?.length) {
    sections.push(`> 附件：${message.contextFiles.map(file => file.name).join('、')}`);
  }

  return sections;
}

function getAssistantSections(message: Extract<ChatMessage, { role: 'assistant' }>) {
  const sections: string[] = [];
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  const toolCalls = message.content.filter(block => block.type === 'toolCall');

  if (text.trim()) {
    sections.push(text.trim());
  }

  for (const toolCall of toolCalls) {
    sections.push(`> 调用工具 \`${toolCall.name}\``);
  }

  if (message.stopReason === 'aborted') {
    sections.push('> 已手动停止，回复可能不完整');
  } else if (message.stopReason === 'length') {
    sections.push('> 达到输出长度上限，回复被截断');
  }

  return sections;
}

function getToolResultSections(message: Extract<ChatMessage, { role: 'toolResult' }>) {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!text) {
    return [];
  }

  return [`**工具 ${message.toolName} 结果**`, `${CODE_FENCE}\n${text}\n${CODE_FENCE}`];
}

function getMessageSections(message: ChatMessage) {
  if (message.role === 'user') {
    const sections = getUserSections(message);
    return sections.length > 0 ? { heading: '## 用户', sections, timestamp: message.timestamp } : undefined;
  }

  if (message.role === 'assistant') {
    const sections = getAssistantSections(message);
    return sections.length > 0 ? { heading: '## 助手', sections, timestamp: message.timestamp } : undefined;
  }

  if (message.role === 'toolResult') {
    const sections = getToolResultSections(message);
    return sections.length > 0 ? { heading: '', sections, timestamp: undefined } : undefined;
  }

  return undefined;
}

/** 把当前分支的会话条目渲染为可读 Markdown 文档。 */
export function buildSessionMarkdown(options: { name: string; entries: ChaptaleSessionTreeEntry[] }): string {
  const blocks: string[] = [`# ${options.name}`];

  for (const entry of options.entries) {
    if (entry.type === 'compaction') {
      blocks.push(
        `> 此处之前的历史已压缩为摘要（原 ${entry.tokensBefore} tokens）：\n>\n> ${entry.summary.replaceAll('\n', '\n> ')}`
      );
      continue;
    }

    if (entry.type !== 'message' && entry.type !== 'custom_message') {
      continue;
    }

    const rendered = getMessageSections(entry.message);

    if (!rendered) {
      continue;
    }

    const time = formatTimestamp(rendered.timestamp);
    const heading = rendered.heading ? `${rendered.heading}${time ? ` · ${time}` : ''}` : '';
    blocks.push([heading, ...rendered.sections].filter(Boolean).join('\n\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}

/** Windows 文件名非法字符替换。 */
export function toSafeFileName(name: string) {
  const safe = name.replaceAll(/[\\/:*?"<>|\r\n]+/g, '-').trim();
  return (safe || '未命名会话').slice(0, 50);
}
