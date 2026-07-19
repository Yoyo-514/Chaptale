import type { ChatContentBlock, ChatImageContent, ChatMessage, ChatTextContent } from '@chaptale/shared';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

import { toChatMessages, type PiMessageMappingOptions } from '../agent/message-mapper';

type PiMessage = Parameters<SessionManager['appendMessage']>[0];

type MinimalPiTextContent = {
  type: 'text';
  text: string;
};

type MinimalPiImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

type MinimalPiToolCall = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type MinimalPiThinkingContent = {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
};

type MinimalPiAssistantMessage = {
  role: 'assistant';
  content: (MinimalPiTextContent | MinimalPiImageContent | MinimalPiToolCall | MinimalPiThinkingContent)[];
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
  errorMessage?: string;
  timestamp: number;
};

type MinimalPiToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (MinimalPiTextContent | MinimalPiImageContent)[];
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

function toPiContentBlocks(content: ChatContentBlock[]) {
  return content
    .map(block => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      }

      if (block.type === 'thinking') {
        return {
          type: 'thinking' as const,
          thinking: block.thinking,
          thinkingSignature: block.thinkingSignature
        };
      }

      if (block.type === 'toolCall') {
        return {
          type: 'toolCall' as const,
          id: block.id,
          name: block.name,
          arguments: block.arguments
        };
      }

      if (block.type === 'image') {
        return { type: 'image' as const, data: block.data, mimeType: block.mimeType };
      }

      return undefined;
    })
    .filter(
      (block): block is MinimalPiTextContent | MinimalPiImageContent | MinimalPiToolCall | MinimalPiThinkingContent =>
        Boolean(block)
    );
}

function isTextOrImageBlock(block: ChatContentBlock): block is ChatTextContent | ChatImageContent {
  return block.type === 'text' || block.type === 'image';
}

function getTextFromUserContent(content: Extract<ChatMessage, { role: 'user' }>['content']) {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

/**
 * 将应用消息转换为 pi SessionManager 可持久化的最小消息结构。
 *
 * UI 专用附件描述不会写入 pi content；用户文本、模型元数据和工具结果只保留 SDK 恢复会话所需字段。
 */
export function toPiMessage(message: ChatMessage): PiMessage {
  const timestamp = Date.now();

  if (message.role === 'user') {
    return {
      role: 'user',
      content: getTextFromUserContent(message.content),
      timestamp
    } as PiMessage;
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: toPiContentBlocks(message.content),
      api: message.api ?? 'chaptale',
      provider: message.provider ?? 'chaptale',
      model: message.model ?? 'chaptale-current',
      usage: createZeroUsage(),
      stopReason: message.stopReason ?? (message.content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop'),
      errorMessage: message.errorMessage,
      timestamp
    } satisfies MinimalPiAssistantMessage as PiMessage;
  }

  if (message.role === 'toolResult') {
    return {
      role: 'toolResult',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content.filter(isTextOrImageBlock),
      isError: Boolean(message.isError),
      timestamp
    } satisfies MinimalPiToolResultMessage as PiMessage;
  }

  return {
    role: 'user',
    content: '',
    timestamp
  } as PiMessage;
}

/** 从单条 pi 持久化消息恢复首个应用消息；未知角色或无有效载荷的用户消息返回 undefined。 */
export function fromPiMessage(message: unknown, options?: PiMessageMappingOptions): ChatMessage | undefined {
  return toChatMessages(message, options)[0];
}
