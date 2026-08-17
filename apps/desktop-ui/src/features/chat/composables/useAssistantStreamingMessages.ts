import type { ChatMessage } from '@chaptale/shared';

import type { ChatDisplayMessage } from '../types';
import {
  getAssistantReasoning,
  getAssistantText,
  getAssistantToolCalls,
  getPrimaryToolCall
} from '../utils/message/message-content';
import { useStreamingMessageBuffer } from './useStreamingMessageBuffer';

type CreateDisplayMessage = (message: ChatMessage, prefix?: string) => ChatDisplayMessage;

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;

/**
 * 把 Agent 的增量事件归并到 ChatView 消息投影。
 *
 * 文本和 reasoning 先经缓冲批量刷新；工具调用及结果按调用 ID 更新，
 * 最终 assistant 消息则替换末尾的流式占位，减少同一次运行产生的重复展示。
 */
export function useAssistantStreamingMessages(options: {
  getMessages: () => ChatDisplayMessage[];
  createDisplayMessage: CreateDisplayMessage;
}) {
  const streamingTextBuffer = useStreamingMessageBuffer(delta => {
    appendAssistantDelta(delta, 'content');
  });
  const streamingReasoningBuffer = useStreamingMessageBuffer(delta => {
    appendAssistantDelta(delta, 'reasoning');
  });

  function flush() {
    streamingReasoningBuffer.flushNow();
    streamingTextBuffer.flushNow();
  }

  function reset() {
    streamingReasoningBuffer.reset();
    streamingTextBuffer.reset();
  }

  function pushText(delta: string) {
    streamingTextBuffer.push(delta);
  }

  function pushReasoning(delta: string) {
    streamingReasoningBuffer.push(delta);
  }

  function ensureStreamingAssistant() {
    const streamingAssistant = getStreamingAssistant();

    if (streamingAssistant) {
      return streamingAssistant;
    }

    const message: ChatMessage = {
      role: 'assistant',
      partial: true,
      content: '',
      timestamp: Date.now()
    };
    messages().push(options.createDisplayMessage(message));
    return message;
  }

  function updateReasoningStatus(status: 'streaming' | 'done') {
    const message = ensureStreamingAssistant();

    if (status === 'done') {
      message.partial = false;
    }
  }

  /** partial 快照语义：思维链累计文本直接覆盖（幂等，不叠加）。 */
  function replaceReasoning(text: string) {
    const message = ensureStreamingAssistant();
    message.reasoning = text;
  }

  /** 合并非 delta 消息；工具结果按 toolCallId 幂等更新，最终 assistant 消息替换当前流式占位。 */
  function appendOrReplaceAssistantMessage(message: ChatMessage) {
    const currentMessages = messages();

    if (message.role === 'tool') {
      const existingResult = currentMessages.find(
        item => item.message.role === 'tool' && item.message.toolCallId === message.toolCallId
      );

      if (existingResult) {
        existingResult.message = message;
      } else {
        currentMessages.push(options.createDisplayMessage(message));
      }
      return;
    }

    if (message.role !== 'assistant') {
      currentMessages.push(options.createDisplayMessage(message));
      return;
    }

    const incomingToolCalls = getAssistantToolCalls(message);
    const lastDisplayMessage = currentMessages.at(-1);
    const lastMessage = lastDisplayMessage?.message;

    if (lastDisplayMessage && lastMessage?.role === 'assistant' && lastMessage.partial) {
      lastDisplayMessage.message =
        incomingToolCalls.length > 0 ? { ...message, content: mergeAssistantContent(lastMessage, message) } : message;
      return;
    }

    if (incomingToolCalls.length > 0 && updateExistingToolCalls(currentMessages, message)) {
      return;
    }

    currentMessages.push(options.createDisplayMessage(message));
  }

  function appendErrorMessage(message: string) {
    removeEmptyStreamingAssistant();
    messages().push(options.createDisplayMessage(createAssistantErrorMessage(message), 'error'));
  }

  function finishMessages() {
    flush();
    removeEmptyStreamingAssistant();
    markStreamingAssistantComplete();
  }

  function getStreamingAssistant() {
    const lastMessage = messages().at(-1)?.message;

    return lastMessage?.role === 'assistant' && lastMessage.partial ? lastMessage : undefined;
  }

  function appendAssistantDelta(delta: string, target: 'content' | 'reasoning') {
    const message = ensureStreamingAssistant();

    if (target === 'reasoning') {
      message.reasoning = (message.reasoning ?? '') + delta;
      return;
    }

    message.content =
      typeof message.content === 'string' ? message.content + delta : concatParts(message.content, delta);
  }

  function markStreamingAssistantComplete() {
    const lastMessage = getStreamingAssistant();

    if (lastMessage) {
      lastMessage.partial = false;
    }
  }

  function removeEmptyStreamingAssistant() {
    const currentMessages = messages();
    const lastDisplayMessage = currentMessages.at(-1);
    const lastMessage = lastDisplayMessage?.message;

    if (lastMessage?.role === 'assistant' && lastMessage.partial && !hasAssistantPayload(lastMessage)) {
      currentMessages.pop();
    }
  }

  function messages() {
    return options.getMessages();
  }

  return {
    flush,
    reset,
    pushText,
    pushReasoning,
    replaceReasoning,
    ensureStreamingAssistant,
    updateReasoningStatus,
    appendOrReplaceAssistantMessage,
    appendErrorMessage,
    finishMessages
  };
}

function createAssistantErrorMessage(message: string): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now()
  };
}

/** 保留已流式生成的文本与 reasoning，按调用 ID 更新工具调用，防止终态事件重复追加。 */
function mergeAssistantContent(previous: AssistantMessage, incoming: AssistantMessage): AssistantMessage['content'] {
  const previousText = getAssistantText(previous);
  const incomingText = getAssistantText(incoming);
  const mergedText = incomingText || previousText;

  return mergedText === '' ? undefined : mergedText;
}

function concatParts(parts: AssistantMessage['content'], delta: string): AssistantMessage['content'] {
  if (parts === undefined) {
    return delta === '' ? undefined : delta;
  }

  return getAssistantText({ role: 'assistant', content: parts }) + delta;
}

/**
 * 把终态 assistant 消息并入已存在的工具卡片。
 *
 * 工具调用在 tool-call 事件时就先亮卡片（partial），本步的 usage 要到 finish-step
 * 才随定稿消息到达。定稿消息的 toolCalls 与已有卡片同 ID，若只替换调用体就会把 usage
 * 一起丢掉——纯工具步的 token 消耗因此永远显示不出来（ToolCallGroup 按 usage 汇总）。
 * usage 属于整步，只挂到首个命中的消息上，避免并行调用分散在多条消息时被重复计入。
 */
function updateExistingToolCalls(messages: ChatDisplayMessage[], incoming: AssistantMessage) {
  const incomingToolCalls = getAssistantToolCalls(incoming);
  let updatedCount = 0;
  let usageHost: AssistantMessage | undefined;

  for (const incomingCall of incomingToolCalls) {
    for (const displayMessage of messages) {
      if (displayMessage.message.role !== 'assistant') continue;
      const existing = displayMessage.message;
      const existingCalls = getAssistantToolCalls(existing);
      const existingIndex = existingCalls.findIndex(call => call.id === incomingCall.id);

      if (existingIndex >= 0) {
        existing.toolCalls = existingCalls.toSpliced(existingIndex, 1, incomingCall);
        usageHost ??= existing;
        updatedCount += 1;
        break;
      }
    }
  }

  if (updatedCount !== incomingToolCalls.length) {
    return false;
  }

  if (incoming.usage && usageHost && !usageHost.usage) {
    usageHost.usage = incoming.usage;
  }

  return true;
}

function hasAssistantPayload(message: AssistantMessage) {
  return Boolean(
    message.errorMessage?.trim() ||
    message.retry ||
    getAssistantText(message).trim() ||
    getAssistantReasoning(message).trim() ||
    getPrimaryToolCall(message)
  );
}
