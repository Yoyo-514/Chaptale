import type { ChatMessage } from '@chaptale/shared';

export type AgentStartPayload = {
  runId: string;
  query: string;
  sessionId?: string;
  /** 从指定 pi session entry 开始新分支。 */
  branchFromEntryId?: string | null;
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

export type StreamAgentOptions = {
  branchFromEntryId?: string | null;
};

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};
