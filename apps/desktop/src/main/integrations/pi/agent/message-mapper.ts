import type { ChatContentBlock, ChatMessage, ChatMessageUsage, ChatStopReason } from '@chaptale/shared';

import {
  decodeImageBase64,
  type ImageAttachmentPresentation,
  type ImageBlock
} from '../../../core/attachments/service';
import { decodeContextMessage } from '../../../core/context/context-message-codec';
import { decodeMemoryMessage } from '../../../features/memory/message-codec';
import { decodeSkillMessage } from '../../../features/skills/message-codec';
import { getPiUserImageBlocks } from '../sessions/user-image-blocks';

export type PiMessageMappingOptions = {
  presentUserImages?: (images: readonly ImageBlock[]) => ImageAttachmentPresentation;
};

/**
 * 将 pi 工具结果压缩为聊天协议中的文本块。
 * 优先提取 SDK 标准 content 文本；其他可 JSON 序列化的结构保留为 JSON。
 */
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

      if (
        block.type === 'image' &&
        typeof block.data === 'string' &&
        typeof block.mimeType === 'string' &&
        decodeImageBase64({ data: block.data, mimeType: block.mimeType })
      ) {
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

function toMessageUsage(value: unknown): ChatMessageUsage | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const cost = record.cost as Record<string, unknown> | undefined;
  const usage: ChatMessageUsage = {
    inputTokens: typeof record.input === 'number' ? record.input : 0,
    outputTokens: typeof record.output === 'number' ? record.output : 0,
    totalTokens: typeof record.totalTokens === 'number' ? record.totalTokens : 0,
    cost: cost && typeof cost === 'object' && typeof cost.total === 'number' ? cost.total : 0
  };

  return usage.totalTokens > 0 || usage.cost > 0 ? usage : undefined;
}

/**
 * 兼容 pi AgentMessage 的现有块结构，并在防腐层内转换为前端 ChatMessage。
 *
 * 用户消息会同时剥离 Skill 与上下文文件信封，并把原始图片转换为轻量附件；无法识别的角色或空用户内容不进入 UI。
 */
export function toChatMessages(message: unknown, options: PiMessageMappingOptions = {}): ChatMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : undefined;
    const text =
      typeof record.content === 'string'
        ? record.content
        : toContentBlocks(record.content)
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
    const decodedSkill = decodeSkillMessage(text);
    // 信封嵌套顺序与拼接一致：skill 内层依次为 memory → context → 用户文本；UI 不展示注入块。
    const decodedMemory = decodeMemoryMessage(decodedSkill.text);
    const decodedContext = decodeContextMessage(decodedMemory.text);
    const skillInvocation = decodedSkill.skillInvocation
      ? { ...decodedSkill.skillInvocation, arguments: decodedContext.text }
      : undefined;
    const rawImages = getPiUserImageBlocks(record);
    const presentation = options.presentUserImages?.(rawImages) ?? { attachments: [] };
    const content =
      presentation.attachments.length > 0
        ? [
            ...(decodedContext.text ? [{ type: 'text' as const, text: decodedContext.text }] : []),
            ...presentation.attachments
          ]
        : decodedContext.text;

    return decodedContext.text ||
      skillInvocation ||
      decodedContext.contextFiles.length > 0 ||
      presentation.attachments.length > 0
      ? [
          {
            role: 'user',
            content,
            ...(decodedContext.contextFiles.length > 0 ? { contextFiles: decodedContext.contextFiles } : {}),
            ...(skillInvocation ? { skillInvocation } : {}),
            timestamp
          }
        ]
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
        usage: toMessageUsage(record.usage),
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
