import type { ChatMessage } from '@chaptale/shared';

export function hasRenderableMessage(message: ChatMessage, variant?: 'normal' | 'error') {
  if (message.type === 'system') {
    return variant === 'error' && message.payload.content.trim().length > 0;
  }

  if (message.type === 'assistant') {
    return Boolean(
      message.partial ||
      message.payload.content.trim() ||
      message.payload.reasoning?.trim() ||
      message.payload.reasoningStatus === 'streaming'
    );
  }

  if (message.type === 'user') {
    return message.payload.content.trim().length > 0;
  }

  return true;
}

export function getMessagePlainText(message: ChatMessage) {
  if (message.type === 'tool_call') {
    return JSON.stringify(message.payload.args, null, 2);
  }

  if ('content' in message.payload) {
    return message.payload.content;
  }

  return '';
}

export function formatToolName(name: string) {
  if (name === 'websearch') {
    return '联网搜索';
  }

  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
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
