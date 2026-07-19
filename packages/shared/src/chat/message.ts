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

/**
 * 应用内部及 IPC 共用的聊天消息联合。
 * 用户消息使用轻量附件描述，助手消息保留流式与模型元数据，工具结果通过 toolCallId 与调用配对。
 */
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
