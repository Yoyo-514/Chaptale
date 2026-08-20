import { sift } from 'radash';

import type { ChatImageAttachment, ChatMessage, ChatTextPart, ChatToolCall } from '@chaptale/shared';
import { formatSkillInvocation } from '@chaptale/shared';

/** 附件信封前缀：落盘保留给模型回放；展示层一律剥离（与 main 侧 context-message-codec 同款正则）。 */
const CONTEXT_ENVELOPE_PATTERN = /^<attached_context_files>\r?\n([\s\S]*?)\r?\n<\/attached_context_files>\r?\n\r?\n?/;

function stripContextEnvelope(text: string): string {
  return text.replace(CONTEXT_ENVELOPE_PATTERN, '');
}

export function getUserDisplayText(message: Extract<ChatMessage, { role: 'user' }>) {
  if (typeof message.content === 'string') {
    return stripContextEnvelope(message.content);
  }

  return stripContextEnvelope(
    message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n')
  );
}

export function getUserText(message: Extract<ChatMessage, { role: 'user' }>) {
  const displayText = getUserDisplayText(message);

  if (!message.skillInvocation) {
    return displayText;
  }

  return formatSkillInvocation({ ...message.skillInvocation, arguments: displayText });
}

export function getUserSkillInvocation(message: Extract<ChatMessage, { role: 'user' }>) {
  return message.skillInvocation;
}

export function getUserContextFiles(message: Extract<ChatMessage, { role: 'user' }>) {
  return message.contextFiles ?? [];
}

export function getUserImages(message: Extract<ChatMessage, { role: 'user' }>) {
  if (typeof message.content === 'string') {
    return [];
  }

  return message.content.filter(part => part.type === 'imageAttachment');
}

export function hasUserAttachments(message: Extract<ChatMessage, { role: 'user' }>) {
  return getUserContextFiles(message).length > 0 || getUserImages(message).length > 0;
}

/** assistant 文本：字符串直取，分段拼接。 */
export function getAssistantText(message: Extract<ChatMessage, { role: 'assistant' }>) {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return (message.content ?? []).map(part => part.text).join('\n');
}

export function getAssistantReasoning(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return message.reasoning ?? '';
}

export function getAssistantReasoningStatus(message: Extract<ChatMessage, { role: 'assistant' }>) {
  if (message.partial && message.reasoning) {
    return 'streaming' as const;
  }

  if (message.reasoning) {
    return 'done' as const;
  }

  return undefined;
}

export function getAssistantToolCalls(message: Extract<ChatMessage, { role: 'assistant' }>): ChatToolCall[] {
  return message.toolCalls ?? [];
}

export function getPrimaryToolCall(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return getAssistantToolCalls(message)[0];
}

/** 工具结果载荷中的图片（details.images 优先，兼容 output.images）。 */
export function getToolResultImages(message: Extract<ChatMessage, { role: 'tool' }>) {
  const carrier = (message.details as { images?: unknown } | undefined) ?? message.output;

  return readImagesFromToolOutput(carrier);
}

function readImagesFromToolOutput(output: unknown): ChatImageAttachment[] {
  if (!output || typeof output !== 'object') {
    return [];
  }

  const candidate = output as { images?: unknown };

  if (!Array.isArray(candidate.images)) {
    return [];
  }

  return candidate.images.filter(
    (image): image is ChatImageAttachment =>
      Boolean(image) && typeof image === 'object' && (image as { type?: string }).type === 'imageAttachment'
  );
}

/**
 * 判断消息是否包含任何界面可见载荷。
 * 流式 assistant 即使内容尚空也必须保留占位；用户附件和工具图片则可在没有文本时独立展示。
 */
export function hasRenderableMessage(message: ChatMessage) {
  if (message.role === 'assistant') {
    return Boolean(
      message.partial ||
      message.errorMessage?.trim() ||
      message.retry ||
      getAssistantText(message).trim() ||
      getAssistantReasoning(message).trim() ||
      getPrimaryToolCall(message)
    );
  }

  if (message.role === 'user') {
    return (
      getUserText(message).trim().length > 0 ||
      getUserContextFiles(message).length > 0 ||
      getUserImages(message).length > 0
    );
  }

  if (message.role === 'tool') {
    return getToolResultImages(message).length > 0 || formatUnknownToolPayload(message.output).trim().length > 0;
  }

  return true;
}

/** 提取复制与会话搜索使用的稳定纯文本，不包含缩略图、状态标签等展示数据。 */
export function getMessagePlainText(message: ChatMessage) {
  if (message.role === 'user') {
    return getUserText(message);
  }

  if (message.role === 'assistant') {
    if (message.errorMessage) {
      return message.errorMessage;
    }

    const toolCall = getPrimaryToolCall(message);

    if (toolCall) {
      return JSON.stringify(toolCall.arguments, null, 2);
    }

    return getAssistantText(message);
  }

  if (message.role === 'tool') {
    return formatUnknownToolPayload(message.output);
  }

  return '';
}

export function formatToolName(name: string) {
  const labels: Record<string, string> = {
    web_search: '联网搜索',
    fetch_content: '读取网页',
    get_search_content: '取回搜索内容',
    skill_read: '读取技能'
  };

  if (labels[name]) {
    return labels[name];
  }

  return sift(name.split(/[-_\s]+/))
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatUnknownToolPayload(value: unknown) {
  if (typeof value === 'string') {
    return formatMaybeJson(value);
  }

  return JSON.stringify(value ?? null, null, 2);
}

export function formatMaybeJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export type { ChatTextPart };
