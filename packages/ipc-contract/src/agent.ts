import type { ChatMessage } from '@chaptale/shared';

export type AgentStartPayload = {
  runId: string;
  query: string;
  sessionId?: string;
};

export type AgentHistoryPayload = {
  sessionId?: string;
};

export type AgentRunResult = {
  runId: string;
};

export type AgentMessageEvent = {
  runId: string;
  message: ChatMessage;
};

export type AgentDoneEvent = AgentRunResult;

export type AgentErrorEvent = {
  runId: string;
  message: string;
};

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};
