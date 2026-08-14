import type { AssistantModelMessage, ModelMessage, ToolCallPart, ToolResultPart } from 'ai';

import type { SessionContentPart, SessionMessage } from '../sessions/entry';
import type { AssistantStepRecord, ToolResultRecord } from './types';
/**
 * SessionMessage（store 载荷，OpenAI 形状）↔ AI SDK ModelMessage 双向转换。
 * 两侧同源同构，此层只做字段名搬运，无语义映射。
 */

/** 回放产物 → streamText 输入。 */
export function toModelMessages(messages: SessionMessage[]): ModelMessage[] {
  return messages.map(toModelMessage);
}

function toModelMessage(message: SessionMessage): ModelMessage {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };

    case 'user':
      return {
        role: 'user',
        content: typeof message.content === 'string' ? message.content : message.content.map(toUserPart)
      };

    case 'assistant':
      return {
        role: 'assistant',
        content: toAssistantContent(message.content, message.toolCalls)
      };

    case 'tool':
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: message.output as ToolResultPart['output']
          }
        ]
      };
  }
}

function toUserPart(part: SessionContentPart) {
  if (part.type === 'text') {
    return { type: 'text' as const, text: part.text };
  }

  // store 的 image part：base64 data + mimeType → AI SDK DataContent(base64 字符串) + mediaType。
  return {
    type: 'image' as const,
    image: part.data,
    mediaType: part.mimeType
  };
}

type AssistantModelContent = AssistantModelMessage['content'];

type SessionToolCall = AssistantStepRecord['toolCalls'][number];

function toAssistantContent(
  content: string | SessionContentPart[] | undefined,
  toolCalls: SessionToolCall[] | undefined
) {
  const parts: Array<Record<string, unknown>> = [];

  if (typeof content === 'string' && content) {
    parts.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        parts.push({ type: 'text', text: part.text });
      }
    }
  }

  for (const call of toolCalls ?? []) {
    parts.push({
      type: 'tool-call',
      toolCallId: call.id,
      toolName: call.name,
      input: call.arguments
    });
  }

  return parts as AssistantModelContent;
}

/** 本轮 step 收集产物 → 落盘载荷。 */
export function stepRecordsToSessionMessages(
  assistant: AssistantStepRecord,
  toolResults: ToolResultRecord[]
): SessionMessage[] {
  const messages: SessionMessage[] = [];

  const assistantMessage: SessionMessage = {
    role: 'assistant',
    content: assistant.text || undefined,
    ...(assistant.reasoning ? { reasoning: assistant.reasoning } : {}),
    toolCalls: assistant.toolCalls.length > 0 ? assistant.toolCalls : undefined,
    usage: assistant.usage
  };
  messages.push(assistantMessage);

  for (const result of toolResults) {
    messages.push({
      role: 'tool',
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      output: result.output
    });
  }

  return messages;
}

/** AI SDK 响应消息（恢复/导出场景）→ store 载荷。 */
export function fromResponseMessages(messages: ModelMessage[]): SessionMessage[] {
  return messages.map((message): SessionMessage => {
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map(part => part.text)
        .join('\n');
      const toolCalls = content
        .filter((part): part is ToolCallPart => part.type === 'tool-call')
        .map(part => ({
          id: part.toolCallId,
          name: part.toolName,
          arguments: (part.input ?? {}) as Record<string, unknown>
        }));

      return {
        role: 'assistant',
        content: text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      } satisfies SessionMessage;
    }

    if (message.role === 'tool') {
      const first = (Array.isArray(message.content) ? message.content : []).find(
        (part): part is ToolResultPart => part.type === 'tool-result'
      );

      if (!first) {
        return { role: 'tool', toolCallId: '', toolName: '', output: null };
      }

      return {
        role: 'tool',
        toolCallId: first.toolCallId,
        toolName: first.toolName,
        output: first.output
      };
    }

    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        return { role: 'user', content: message.content };
      }

      const parts: SessionContentPart[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          parts.push({
            type: 'image',
            mimeType: part.mediaType ?? 'application/octet-stream',
            data: typeof part.image === 'string' ? part.image : ''
          });
        }
      }

      return { role: 'user', content: parts };
    }

    return { role: 'system', content: String(message.content) };
  });
}
