export * from './utils';

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

export const MAX_CHAT_IMAGE_BYTES = 20 * 1024 * 1024;

export type ChatImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ChatImageSource =
  | {
      type: 'session-entry';
      sessionId: string;
      entryId: string;
      blockIndex: number;
    }
  | {
      type: 'context-file';
      path: string;
    };

export type ChatImageAttachment = {
  type: 'imageAttachment';
  id: string;
  mimeType: string;
  originalBytes: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  source?: ChatImageSource;
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

export type ChatMessageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 本条消息的费用（美元）。 */
  cost: number;
};

export type ChatContextFile = {
  path: string;
  name: string;
  size: number;
  kind: 'text' | 'document' | 'image' | 'unsupported';
  mimeType?: string;
  /** Main 生成的缩略图 data URL，不包含原始图片数据。 */
  previewDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  skippedReason?: 'file-too-large' | 'image-too-large';
};

export type ChatMessage =
  | {
      role: 'user';
      content: string | (ChatTextContent | ChatImageAttachment)[];
      contextFiles?: ChatContextFile[];
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
