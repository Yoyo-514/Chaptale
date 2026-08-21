import type { AssistantModelMessage, ModelMessage } from 'ai';

import type { SessionContentPart, SessionMessage } from '../sessions/entry';
import { toModelToolOutput } from '../tool-protocol/model-output';
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
            output: toModelToolOutput(message.output, message.isError === true)
          }
        ]
      };
  }
}

function toUserPart(part: SessionContentPart) {
  if (part.type === 'text') {
    return { type: 'text' as const, text: part.text };
  }

  // store 的 image part：base64 data + mimeType → AI SDK FilePart（ImagePart 已弃用）。
  return {
    type: 'file' as const,
    data: part.data,
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
      output: result.output,
      // 失败标记必须落盘：否则历史回放里工具卡片的"失败"状态永不可达，
      // 且回放转模型消息时无法选用 error-text/error-json 标签。
      ...(result.isError ? { isError: true } : {})
    });
  }

  return messages;
}
