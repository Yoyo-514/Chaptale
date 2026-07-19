import type { ChatMessage } from '@chaptale/shared';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { stringifyToolResult, toChatMessages } from './message-mapper';

export type AgentStreamEventMapping = {
  message?: ChatMessage;
  /** agent_end 且不再重试时为 true，通知流循环结束。 */
  done?: boolean;
};

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;
type AssistantContent = AssistantMessage['content'];

/** Pi 开始处理一条消息时发出的事件。 */
type MessageStartEvent = Extract<AgentSessionEvent, { type: 'message_start' }>;
type MessageUpdateEvent = Extract<AgentSessionEvent, { type: 'message_update' }>;
type ToolStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }>;
type ToolEndEvent = Extract<AgentSessionEvent, { type: 'tool_execution_end' }>;
type RetryStartEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
type RetryEndEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;
type AgentEndEvent = Extract<AgentSessionEvent, { type: 'agent_end' }>;

function assistantMessage(message: Omit<AssistantMessage, 'role' | 'timestamp'>): ChatMessage {
  return {
    role: 'assistant',
    timestamp: Date.now(),
    ...message
  };
}

function assistantPartial(content: AssistantContent): ChatMessage {
  return assistantMessage({ partial: true, content });
}

function assistantError(message: string, retry?: AssistantMessage['retry']): ChatMessage {
  return assistantMessage({
    content: [],
    stopReason: 'error',
    errorMessage: message,
    retry
  });
}

/**
 * 兼容 pi AgentSession 当前事件联合类型，并映射为前端 ChatMessage 协议。
 *
 * 无关事件返回空 mapping；若上游调整事件判别字段，本层测试应率先失败。
 */
export function mapAgentStreamEvent(event: AgentSessionEvent, options: { aborted: boolean }): AgentStreamEventMapping {
  switch (event.type) {
    case 'message_start':
      return mapMessageStartEvent(event);
    case 'message_update':
      return mapMessageUpdateEvent(event);
    case 'tool_execution_start':
      return mapToolExecutionStartEvent(event);
    case 'tool_execution_end':
      return mapToolExecutionEndEvent(event);
    case 'auto_retry_start':
      return mapRetryStartEvent(event);
    case 'auto_retry_end':
      return mapRetryEndEvent(event);
    case 'agent_end':
      return mapAgentEndEvent(event, options);
    default:
      return {};
  }
}

/** 只转发 user message_start；assistant 内容继续使用增量事件，避免重复渲染。 */
function mapMessageStartEvent(event: MessageStartEvent): AgentStreamEventMapping {
  if (event.message.role !== 'user') {
    return {};
  }

  return { message: toChatMessages(event.message)[0] };
}

function mapMessageUpdateEvent(event: MessageUpdateEvent): AgentStreamEventMapping {
  const messageEvent = event.assistantMessageEvent;

  switch (messageEvent.type) {
    case 'text_delta':
      return { message: assistantPartial([{ type: 'text', text: messageEvent.delta }]) };
    case 'thinking_start':
      return { message: assistantPartial([]) };
    case 'thinking_delta':
      return {
        message: assistantPartial([
          { type: 'thinking', thinking: messageEvent.delta, thinkingSignature: 'reasoning_content' }
        ])
      };
    case 'thinking_end':
      return { message: assistantMessage({ partial: false, content: [] }) };
    default:
      return {};
  }
}

function mapToolExecutionStartEvent(event: ToolStartEvent): AgentStreamEventMapping {
  return {
    message: assistantMessage({
      content: [
        {
          type: 'toolCall',
          id: event.toolCallId,
          name: event.toolName,
          arguments: (event.args ?? {}) as Record<string, any>
        }
      ],
      stopReason: 'toolUse'
    })
  };
}

function mapToolExecutionEndEvent(event: ToolEndEvent): AgentStreamEventMapping {
  return {
    message: {
      role: 'toolResult',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      content: [{ type: 'text', text: stringifyToolResult(event.result) }],
      timestamp: Date.now()
    }
  };
}

function mapRetryStartEvent(event: RetryStartEvent): AgentStreamEventMapping {
  return {
    message: assistantError(event.errorMessage, {
      status: 'retrying',
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage
    })
  };
}

function mapRetryEndEvent(event: RetryEndEvent): AgentStreamEventMapping {
  if (event.success) {
    return {};
  }

  const errorMessage = event.finalError ?? '模型请求失败';

  return {
    message: assistantError(errorMessage, {
      status: 'failed',
      attempt: event.attempt,
      maxAttempts: event.attempt,
      finalError: event.finalError
    })
  };
}

function mapAgentEndEvent(event: AgentEndEvent, options: { aborted: boolean }): AgentStreamEventMapping {
  if (event.willRetry) {
    return {};
  }

  const errorMessage = getFinalErrorMessage(event);

  return {
    done: true,
    message: errorMessage && !options.aborted ? assistantError(errorMessage) : undefined
  };
}

function getFinalErrorMessage(event: AgentEndEvent) {
  const lastMessage = event.messages.at(-1);

  return lastMessage && 'stopReason' in lastMessage && lastMessage.stopReason === 'error'
    ? ((lastMessage as { errorMessage?: string }).errorMessage ?? '模型请求失败')
    : undefined;
}
