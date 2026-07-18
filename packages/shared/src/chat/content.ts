import type { ChatImageContent } from './image';

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

export type ChatToolCallContent = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
};

export type ChatContentBlock = ChatTextContent | ChatThinkingContent | ChatImageContent | ChatToolCallContent;
