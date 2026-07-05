import type { ChatContentBlock, ChatMessage, ChatStopReason } from '@chaptale/shared';

export function stringifyToolResult(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content;

    if (Array.isArray(content)) {
      const text = content
        .filter((item): item is { type: 'text'; text: string } =>
          Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
        )
        .map(item => item.text)
        .join('\n');

      if (text) {
        return text;
      }
    }
  }

  return JSON.stringify(result ?? null);
}

function toContentBlocks(content: unknown): ChatContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const block = item as Record<string, unknown>;

      if (block.type === 'text' && typeof block.text === 'string') {
        return { type: 'text', text: block.text, textSignature: block.textSignature as string | undefined };
      }

      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return {
          type: 'thinking',
          thinking: block.thinking,
          thinkingSignature: block.thinkingSignature as string | undefined,
          redacted: typeof block.redacted === 'boolean' ? block.redacted : undefined
        };
      }

      if (block.type === 'toolCall' && typeof block.name === 'string') {
        return {
          type: 'toolCall',
          id: typeof block.id === 'string' ? block.id : '',
          name: block.name,
          arguments:
            block.arguments && typeof block.arguments === 'object' ? (block.arguments as Record<string, any>) : {},
          thoughtSignature: block.thoughtSignature as string | undefined
        };
      }

      if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
        return { type: 'image', data: block.data, mimeType: block.mimeType };
      }

      return undefined;
    })
    .filter((block): block is ChatContentBlock => Boolean(block));
}

function toStopReason(value: unknown): ChatStopReason | undefined {
  return value === 'stop' || value === 'length' || value === 'toolUse' || value === 'error' || value === 'aborted'
    ? value
    : undefined;
}

/** 将 pi AgentMessage 转换为前端 ChatMessage（用于历史回放）。 */
export function toChatMessages(message: unknown): ChatMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    if (typeof record.content === 'string') {
      return record.content
        ? [
            {
              role: 'user',
              content: record.content,
              timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined
            }
          ]
        : [];
    }

    const content = toContentBlocks(record.content).filter(block => block.type === 'text' || block.type === 'image');

    return content.length > 0
      ? [{ role: 'user', content, timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined }]
      : [];
  }

  if (record.role === 'assistant') {
    return [
      {
        role: 'assistant',
        content: toContentBlocks(record.content),
        stopReason: toStopReason(record.stopReason),
        errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : undefined,
        api: typeof record.api === 'string' ? record.api : undefined,
        provider: typeof record.provider === 'string' ? record.provider : undefined,
        model: typeof record.model === 'string' ? record.model : undefined,
        responseId: typeof record.responseId === 'string' ? record.responseId : undefined,
        timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined
      }
    ];
  }

  if (record.role === 'toolResult') {
    return [
      {
        role: 'toolResult',
        toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : '',
        toolName: typeof record.toolName === 'string' ? record.toolName : 'tool',
        content: toContentBlocks(record.content).filter(block => block.type === 'text' || block.type === 'image'),
        isError: typeof record.isError === 'boolean' ? record.isError : undefined,
        timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined
      }
    ];
  }

  return [];
}
