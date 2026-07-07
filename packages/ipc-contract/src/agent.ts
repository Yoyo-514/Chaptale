import type { ChatMessage } from '@chaptale/shared';

export type SelectedContextFile = {
  path: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'unsupported';
  mimeType?: string;
  /** 小图预览（仅限体积较小的图片，data URL）。 */
  previewDataUrl?: string;
};

export type AgentStartPayload = {
  runId: string;
  query: string;
  sessionId?: string;
  /** 从指定 pi session entry 开始新分支。 */
  branchFromEntryId?: string | null;
  /** 本轮随用户消息附加的本地上下文文件路径。 */
  contextFilePaths?: string[];
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
};

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};
