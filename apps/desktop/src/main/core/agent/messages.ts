import type { AssistantModelMessage, JSONValue, ModelMessage, ToolResultPart } from 'ai';

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
            output: toToolResultOutput(message.output, message.isError === true)
          }
        ]
      };
  }
}

/**
 * 工具输出 → AI SDK `ToolResultPart['output']` 标签联合。
 *
 * 落盘存的是 `execute` 的原始返回值（UI 与历史导出直接读它渲染，不能包装），
 * 但 provider 侧是 `switch (output.type)` 且**没有 default 分支**——
 * 未打标签的对象会算出 `content: undefined`，回放时整条工具结果对模型消失。
 * 单轮内不暴露此问题：SDK 用自己的内存副本，包装由它内部完成；
 * 只有走本函数的历史回放会踩到。故归一化必须在这一层做。
 *
 * 已带合法 tag 的值原样透传（幂等），便于未来直接落标签形态。
 */
function toToolResultOutput(output: unknown, isError: boolean): ToolResultPart['output'] {
  if (isTaggedToolOutput(output)) {
    return output;
  }

  if (typeof output === 'string') {
    return { type: isError ? 'error-text' : 'text', value: output };
  }

  return { type: isError ? 'error-json' : 'json', value: (output ?? null) as JSONValue };
}

/** SDK 侧会原样消费的标签；`content` 另需数组 value（SDK 会对它调 .map）。 */
const TOOL_OUTPUT_TAGS = new Set(['text', 'json', 'error-text', 'error-json', 'execution-denied']);

function isTaggedToolOutput(output: unknown): output is ToolResultPart['output'] {
  if (typeof output !== 'object' || output === null || !('type' in output)) {
    return false;
  }

  const tag = (output as { type: unknown }).type;

  if (typeof tag !== 'string') {
    return false;
  }

  // 形状不合法的 content 不能放行：SDK 会对 value 调 .map()，非数组直接崩。
  // 退回 json 包装是安全的降级——模型仍看得到全部内容。
  if (tag === 'content') {
    return Array.isArray((output as { value?: unknown }).value);
  }

  return TOOL_OUTPUT_TAGS.has(tag);
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
