import type { ChatMessage } from '@chaptale/shared';
import type { Static } from 'typebox';
import type { AgentStartPayloadSchema } from './schemas/agent';

/** Renderer 发起 Agent 流式运行时传入的 IPC payload。 */
export type AgentStartPayload = Static<typeof AgentStartPayloadSchema>;

/** IPC 调用确认结果；runId 同时用于关联后续流式事件与取消请求。 */
export type AgentRunResult = {
  runId: string;
};

/** 主进程推送的增量消息事件，Renderer 必须按 runId 路由到对应运行。 */
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

/** Preload 为单次流式运行接收的回调集合；done 与 error 都是终态。 */
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
