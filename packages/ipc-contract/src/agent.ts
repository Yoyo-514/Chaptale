import type { ChatContextFile, ChatMessage } from '@chaptale/shared';

export type SelectedContextFile = ChatContextFile;

export type AgentStartPayload = {
  runId: string;
  query: string;
  sessionId?: string;
  /** 从指定 pi session entry 开始新分支。 */
  branchFromEntryId?: string | null;
  /** 本轮随用户消息附加的本地上下文文件路径。 */
  contextFilePaths?: string[];
  /** 复用指定 Pi user entry 中已持久化的文件信封与原生图片块。 */
  reuseUserEntryId?: string;
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
  contextFilePaths?: string[];
  reuseUserEntryId?: string;
};

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};
