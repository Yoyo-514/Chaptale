import type { ChatMessage } from '@chaptale/shared';
import type { Static } from 'typebox';
import type { AgentStartPayloadSchema } from './schemas/agent';

/** Renderer 发起 Agent 流式运行时传入的 IPC payload。 */
export type AgentStartPayload = Static<typeof AgentStartPayloadSchema>;

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

export type StreamAgentOptions = Pick<AgentStartPayload, 'branchFromEntryId' | 'contextFilePaths' | 'reuseUserEntryId'>;

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

/**
 * 主进程 Agent 运行时入参：与 AgentStartPayload 同源派生，
 * 把 IPC 侧的 runId 换成进程内的 AbortSignal，并要求已解析好的 sessionId。
 */
export type AgentRunOptions = Omit<AgentStartPayload, 'runId' | 'sessionId'> & {
  sessionId: string;
  signal: AbortSignal;
};

/**
 * Agent 运行时抽象（原 @chaptale/agent-core）。
 *
 * desktop 由 pi SDK 实现；未来其他端可由 HTTP/WebSocket/native runtime 实现。
 * 不包含 Electron、Node fs 或 pi SDK 类型。
 */
export interface AgentRuntime {
  stream(options: AgentRunOptions): AsyncGenerator<ChatMessage>;
}
