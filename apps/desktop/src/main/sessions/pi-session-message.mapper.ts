import type { ChatMessage } from '@chaptale/shared';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

type PiMessage = Parameters<SessionManager['appendMessage']>[0];

type MinimalPiTextContent = {
  type: 'text';
  text: string;
};

type MinimalPiToolCall = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type MinimalPiAssistantMessage = {
  role: 'assistant';
  content: (MinimalPiTextContent | MinimalPiToolCall)[];
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  timestamp: number;
};

type MinimalPiToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: MinimalPiTextContent[];
  isError: boolean;
  timestamp: number;
};

function createZeroUsage(): MinimalPiAssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

export function getTextFromPiContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const block = item as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }

      if (block.type === 'toolCall' && typeof block.name === 'string') {
        return `调用工具：${block.name}`;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function toPiMessage(message: ChatMessage): PiMessage {
  const timestamp = Date.now();

  if (message.type === 'user') {
    return {
      role: 'user',
      content: message.payload.content,
      timestamp
    } as PiMessage;
  }

  if (message.type === 'assistant') {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.payload.content }],
      api: 'chaptale',
      provider: 'chaptale',
      model: 'chaptale-current',
      usage: createZeroUsage(),
      stopReason: 'stop',
      timestamp
    } satisfies MinimalPiAssistantMessage as PiMessage;
  }

  if (message.type === 'tool_call') {
    return {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: message.payload.id,
          name: message.payload.name,
          arguments: message.payload.args
        }
      ],
      api: 'chaptale',
      provider: 'chaptale',
      model: 'chaptale-current',
      usage: createZeroUsage(),
      stopReason: 'toolUse',
      timestamp
    } satisfies MinimalPiAssistantMessage as PiMessage;
  }

  if (message.type === 'tool_result') {
    return {
      role: 'toolResult',
      toolCallId: message.payload.tool_call_id,
      toolName: message.payload.name,
      content: [{ type: 'text', text: message.payload.content }],
      isError: false,
      timestamp
    } satisfies MinimalPiToolResultMessage as PiMessage;
  }

  return {
    role: 'user',
    content: message.payload.content,
    timestamp
  } as PiMessage;
}

export function fromPiMessage(message: unknown): ChatMessage | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    return {
      type: 'user',
      payload: {
        content: getTextFromPiContent(record.content)
      }
    };
  }

  if (record.role === 'assistant') {
    const content = Array.isArray(record.content) ? record.content : [];
    const toolCall = content.find(item =>
      Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'toolCall')
    ) as Record<string, unknown> | undefined;

    if (toolCall) {
      return {
        type: 'tool_call',
        payload: {
          id: typeof toolCall.id === 'string' ? toolCall.id : '',
          name: typeof toolCall.name === 'string' ? toolCall.name : 'tool',
          args:
            typeof toolCall.arguments === 'object' && toolCall.arguments !== null
              ? (toolCall.arguments as Record<string, any>)
              : {}
        }
      };
    }

    return {
      type: 'assistant',
      payload: {
        content: getTextFromPiContent(content)
      }
    };
  }

  if (record.role === 'toolResult') {
    return {
      type: 'tool_result',
      payload: {
        tool_call_id: typeof record.toolCallId === 'string' ? record.toolCallId : '',
        name: typeof record.toolName === 'string' ? record.toolName : 'tool',
        content: getTextFromPiContent(record.content)
      }
    };
  }

  return undefined;
}
