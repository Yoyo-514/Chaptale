import type { ChatMessage } from '@chaptale/shared';

export type AgentRunOptions = {
  query: string;
  sessionId: string;
  signal: AbortSignal;
  /** 从指定 pi session entry 开始新分支；下一条用户消息会成为该 entry 的子节点。 */
  branchFromEntryId?: string | null;
  /** 本轮随用户消息附加的本地上下文文件路径。 */
  contextFilePaths?: string[];
  /** 复用指定 Pi user entry 中已经持久化的附件快照。 */
  reuseUserEntryId?: string;
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
  stream(options: AgentRunOptions): AsyncGenerator<ChatMessage>;
}

export interface CancellableAgentRuntime extends AgentRuntime {
  cancel?(runId: string): Promise<AgentRunResult>;
}
