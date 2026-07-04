import type { ChatMessage } from '@chaptale/shared';

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

/** 将 pi AgentMessage 转换为前端 ChatMessage（用于历史回放）。 */
export function toChatMessages(message: unknown): ChatMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    const content = record.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((item): item is { type: 'text'; text: string } =>
                Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
              )
              .map(item => item.text)
              .join('\n')
          : '';

    return text ? [{ type: 'user', payload: { content: text } }] : [];
  }

  if (record.role === 'assistant') {
    const content = Array.isArray(record.content) ? record.content : [];
    const messages: ChatMessage[] = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const block = item as Record<string, unknown>;

      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        messages.push({ type: 'assistant', payload: { content: block.text } });
      }

      if (block.type === 'toolCall') {
        messages.push({
          type: 'tool_call',
          payload: {
            id: typeof block.id === 'string' ? block.id : '',
            name: typeof block.name === 'string' ? block.name : 'tool',
            args: block.arguments && typeof block.arguments === 'object' ? (block.arguments as Record<string, any>) : {}
          }
        });
      }
    }

    return messages;
  }

  if (record.role === 'toolResult') {
    return [
      {
        type: 'tool_result',
        payload: {
          tool_call_id: typeof record.toolCallId === 'string' ? record.toolCallId : '',
          name: typeof record.toolName === 'string' ? record.toolName : 'tool',
          content: stringifyToolResult(record)
        }
      }
    ];
  }

  return [];
}
