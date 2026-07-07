import type {
  ChatContentBlock,
  ChatMessage,
  ChatTextContent,
  ChatThinkingContent,
  ChatToolCallContent
} from '@chaptale/shared';

export function getTextBlocks(content: readonly { type: string }[]): ChatTextContent[] {
  return content.filter((block): block is ChatTextContent => block.type === 'text');
}

export function getThinkingBlocks(content: ChatContentBlock[]) {
  return content.filter((block): block is ChatThinkingContent => block.type === 'thinking');
}

export function getToolCallBlocks(content: ChatContentBlock[]) {
  return content.filter((block): block is ChatToolCallContent => block.type === 'toolCall');
}

export function getUserText(message: Extract<ChatMessage, { role: 'user' }>) {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return getTextBlocks(message.content)
    .map(block => block.text)
    .join('\n');
}

export function getAssistantText(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return getTextBlocks(message.content)
    .map(block => block.text)
    .join('\n');
}

export function getAssistantReasoning(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return getThinkingBlocks(message.content)
    .map(block => block.thinking)
    .join('\n');
}

export function getAssistantReasoningStatus(message: Extract<ChatMessage, { role: 'assistant' }>) {
  if (message.partial && getAssistantReasoning(message)) {
    return 'streaming' as const;
  }

  if (getAssistantReasoning(message)) {
    return 'done' as const;
  }

  return undefined;
}

export function getPrimaryToolCall(message: Extract<ChatMessage, { role: 'assistant' }>) {
  return getToolCallBlocks(message.content)[0];
}

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
    return getUserText(message).trim().length > 0;
  }

  if (message.role === 'toolResult') {
    return getTextBlocks(message.content).some(block => block.text.trim());
  }

  return true;
}

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

  return getTextBlocks(message.content)
    .map(block => block.text)
    .join('\n');
}

export function formatToolName(name: string) {
  const labels: Record<string, string> = {
    web_search: '联网搜索',
    fetch_content: '读取网页',
    get_search_content: '取回搜索内容'
  };

  if (labels[name]) {
    return labels[name];
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
