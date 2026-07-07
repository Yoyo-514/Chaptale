import type { ChatMessage } from '@chaptale/shared';

import type { ChatDisplayMessage } from '../types';
import { getAssistantReasoning, getAssistantText, getPrimaryToolCall } from '../utils/message/message-content';
import { useStreamingMessageBuffer } from './useStreamingMessageBuffer';

type CreateDisplayMessage = (message: ChatMessage, prefix?: string) => ChatDisplayMessage;

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;

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
      content: [],
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

  function appendOrReplaceAssistantMessage(message: ChatMessage) {
    const currentMessages = messages();

    if (message.role !== 'assistant') {
      currentMessages.push(options.createDisplayMessage(message));
      return;
    }

    const lastDisplayMessage = currentMessages.at(-1);
    const lastMessage = lastDisplayMessage?.message;

    if (lastMessage?.role === 'assistant' && lastMessage.partial) {
      currentMessages.splice(currentMessages.length - 1, 1, options.createDisplayMessage(message));
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
      const lastBlock = message.content.at(-1);

      if (lastBlock?.type === 'thinking') {
        lastBlock.thinking += delta;
      } else {
        message.content.push({ type: 'thinking', thinking: delta, thinkingSignature: 'reasoning_content' });
      }

      return;
    }

    const lastBlock = message.content.at(-1);

    if (lastBlock?.type === 'text') {
      lastBlock.text += delta;
    } else {
      message.content.push({ type: 'text', text: delta });
    }
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
    content: [],
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now()
  };
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
