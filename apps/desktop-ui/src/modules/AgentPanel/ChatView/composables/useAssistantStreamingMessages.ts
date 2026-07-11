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

    if (message.role === 'toolResult') {
      const existingResult = currentMessages.find(
        item => item.message.role === 'toolResult' && item.message.toolCallId === message.toolCallId
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
        incomingToolCalls.length > 0
          ? { ...message, content: mergeAssistantContent(lastMessage.content, message.content) }
          : message;
      return;
    }

    if (incomingToolCalls.length > 0 && updateExistingToolCalls(currentMessages, incomingToolCalls)) {
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

function mergeAssistantContent(
  previous: AssistantMessage['content'],
  incoming: AssistantMessage['content']
): AssistantMessage['content'] {
  const merged = [...previous];

  for (const block of incoming) {
    if (block.type !== 'toolCall') {
      merged.push(block);
      continue;
    }

    const existingIndex = merged.findIndex(candidate => candidate.type === 'toolCall' && candidate.id === block.id);

    if (existingIndex >= 0) {
      merged.splice(existingIndex, 1, block);
    } else {
      merged.push(block);
    }
  }

  return merged;
}

function updateExistingToolCalls(
  messages: ChatDisplayMessage[],
  incomingToolCalls: ReturnType<typeof getAssistantToolCalls>
) {
  let updatedCount = 0;

  for (const incomingCall of incomingToolCalls) {
    for (const displayMessage of messages) {
      if (displayMessage.message.role !== 'assistant') continue;
      const existingIndex = displayMessage.message.content.findIndex(
        block => block.type === 'toolCall' && block.id === incomingCall.id
      );

      if (existingIndex >= 0) {
        displayMessage.message.content.splice(existingIndex, 1, incomingCall);
        updatedCount += 1;
        break;
      }
    }
  }

  return updatedCount === incomingToolCalls.length;
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
