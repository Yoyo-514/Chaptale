import type { ChatMessage } from '@chaptale/shared';

export type AgentRunOptions = {
  query: string;
  sessionId: string;
  signal: AbortSignal;
};

export type AgentRunResult = {
  runId: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  error?: string;
};

/**
 * 跨端 Agent Runtime 抽象。
 *
 * desktop 可由 pi SDK 实现；移动端未来可由 HTTP/WebSocket/native runtime 实现。
 * 这里不包含 Electron、Node fs 或 pi SDK 类型，确保 packages/agent-core 可跨运行时复用。
 */
export interface AgentRuntime {
  getHistory(sessionId: string): Promise<ChatMessage[]>;
  stream(options: AgentRunOptions): AsyncGenerator<ChatMessage>;
}

export interface CancellableAgentRuntime extends AgentRuntime {
  cancel?(runId: string): Promise<AgentRunResult>;
}
