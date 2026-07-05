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
    const reasoning = content
      .map(item => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        const block = item as Record<string, unknown>;
        return block.type === 'thinking' && typeof block.thinking === 'string' ? block.thinking : '';
      })
      .filter(Boolean)
      .join('\n');

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const block = item as Record<string, unknown>;

      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        messages.push({
          type: 'assistant',
          payload: {
            content: block.text,
            reasoning: reasoning || undefined,
            reasoningStatus: reasoning ? 'done' : undefined
          }
        });
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

    if (messages.length === 0 && reasoning) {
      messages.push({ type: 'assistant', payload: { content: '', reasoning, reasoningStatus: 'done' } });
    }

    if (messages.length === 0 && record.stopReason === 'error' && typeof record.errorMessage === 'string') {
      messages.push({ type: 'system', payload: { content: record.errorMessage } });
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
