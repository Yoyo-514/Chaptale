import type { ChatMessage } from '@chaptale/shared';

export type AgentRunId = string;

export type AgentRunMessageEvent = {
  type: 'message';
  runId: AgentRunId;
  message: ChatMessage;
};

export type AgentRunDoneEvent = {
  type: 'done';
  runId: AgentRunId;
};

export type AgentRunErrorEvent = {
  type: 'error';
  runId: AgentRunId;
  message: string;
};

export type AgentRunEvent = AgentRunMessageEvent | AgentRunDoneEvent | AgentRunErrorEvent;

export type AgentStreamHandlers = {
  onMessage?: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};
