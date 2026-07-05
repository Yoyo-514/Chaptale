export type ChatTextContent = {
  type: 'text';
  text: string;
  textSignature?: string;
};

export type ChatThinkingContent = {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

export type ChatImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ChatToolCallContent = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
};

export type ChatContentBlock = ChatTextContent | ChatThinkingContent | ChatImageContent | ChatToolCallContent;

export type ChatStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export type ChatRetryState = {
  status: 'retrying' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
};

export type ChatMessage =
  | {
      role: 'user';
      content: string | (ChatTextContent | ChatImageContent)[];
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

export type WebsearchResult = {
  title: string;
  link: string;
  description?: string;
}[];
