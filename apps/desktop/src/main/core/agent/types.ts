import type { PermissionDecision, RiskLevel } from '@chaptale/shared';

/**
 * core/agent 对外端口：实现在装配层注入，core 不依赖 features。
 */

/** 权限闸门端口：工具执行前仲裁。实现在装配层桥接 PermissionBroker。 */
export type PermissionGatePort = {
  check(input: {
    sessionId: string;
    toolName: string;
    riskLevel: RiskLevel;
    args: Record<string, unknown>;
    /**
     * 本次工具调用的取消信号。
     *
     * 授权是会挂起的：运行被取消时必须让挂起的请求立刻以拒绝收尾，
     * 否则工具执行与授权卡片会一起等到 broker 的 5 分钟超时。
     */
    signal?: AbortSignal;
  }): Promise<PermissionDecision>;
};

/** 每步落盘端口：引擎在 step 边界调用（默认实现 = SessionStore.appendMessage）。 */
export type StepSink = {
  appendAssistantStep(step: AssistantStepRecord): Promise<void>;
  appendToolResult(record: ToolResultRecord): Promise<void>;
};

/** 单步 assistant 载荷（含 usage 与工具调用）。 */
export type AssistantStepRecord = {
  text: string;
  /** 思维链文本（reasoning 模型；不进回放，仅供落盘展示）。 */
  reasoning?: string;
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

/** 工具结果载荷。 */
export type ToolResultRecord = {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  /** 补位而非工具产出：调用发出去了，运行却中断在它跑完之前。 */
  interrupted?: boolean;
};

/** 事件信封：IPC 透传协议（part 原样携带 AI SDK 流事件）。 */
export type AgentStreamEnvelope = {
  sessionId: string;
  seq: number;
  part: unknown;
};
