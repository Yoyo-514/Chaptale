import type { ChatContentBlock, ChatTextContent } from './content';
import type { ChatContextFile, ChatSkillInvocation } from './context';
import type { ChatImageAttachment, ChatImageContent } from './image';

export type ChatStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export type ChatRetryState = {
  status: 'retrying' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
};

export type ChatMessageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 本条消息的费用（美元）。 */
  cost: number;
};

export type ChatMessage =
  | {
      role: 'user';
      content: string | (ChatTextContent | ChatImageAttachment)[];
      contextFiles?: ChatContextFile[];
      skillInvocation?: ChatSkillInvocation;
      timestamp?: number;
    }
  | {
      role: 'assistant';
      content: ChatContentBlock[];
      partial?: boolean;
      stopReason?: ChatStopReason;
      errorMessage?: string;
      retry?: ChatRetryState;
      api?: string;
      provider?: string;
      model?: string;
      responseId?: string;
      usage?: ChatMessageUsage;
      timestamp?: number;
    }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: (ChatTextContent | ChatImageContent)[];
      isError?: boolean;
      timestamp?: number;
    };
