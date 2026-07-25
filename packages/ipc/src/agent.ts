import type { Static } from 'typebox';

import type { ChatMessage, MemoryCompactionResult, MemoryContextPressureStatus } from '@chaptale/shared';

import type {
  AgentClearedQueueSchema,
  AgentClearPendingMessagesPayloadSchema,
  AgentEndEventSchema,
  AgentQueueClearResultSchema,
  AgentRunResultSchema,
  AgentStartPayloadSchema,
  AgentSteerPayloadSchema,
  RunEndSchema
} from './schemas/agent';

/** Renderer 发起 Agent 流式运行时传入的 IPC payload。 */
export type AgentStartPayload = Static<typeof AgentStartPayloadSchema>;

/** Renderer 请求把输入追加到活跃运行时使用的 payload。 */
export type AgentSteerPayload = Static<typeof AgentSteerPayloadSchema>;

/** Renderer 请求清空当前运行待处理消息时使用的 payload。 */
export type AgentClearPendingMessagesPayload = Static<typeof AgentClearPendingMessagesPayloadSchema>;

/** IPC 调用确认结果；runId 同时用于关联后续流式事件与取消请求。 */
export type AgentRunResult = Static<typeof AgentRunResultSchema>;

/** 主进程推送的增量消息事件，Renderer 必须按 runId 路由到对应运行。 */
export type AgentMessageEvent = {
  runId: string;
  message: ChatMessage;
};

/** Agent 运行的明确终态；failed 分支始终携带可机器处理的完整错误信息。 */
export type RunEnd = Static<typeof RunEndSchema>;

/** Main 推送的唯一 Agent 终态事件。 */
export type AgentEndEvent = Static<typeof AgentEndEventSchema>;

export type StreamAgentOptions = Pick<AgentStartPayload, 'branchFromEntryId' | 'contextFilePaths' | 'reuseUserEntryId'>;

/** Preload 发送 steer 时允许附带的应用选项。 */
export type SteerAgentOptions = Pick<AgentSteerPayload, 'contextFilePaths'>;

/** Runtime 清空队列后返回的项目级消息集合，不包含 Pi SDK 类型。 */
export type AgentClearedQueue = Static<typeof AgentClearedQueueSchema>;

/** IPC 清空队列的确认结果。 */
export type AgentQueueClearResult = Static<typeof AgentQueueClearResultSchema>;

/** Preload 为单次流式运行接收的回调集合；所有终态统一经 onEnd 判别。 */
export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onEnd?: (end: RunEnd) => void;
};

/**
 * 主进程 Agent 运行时入参：与 AgentStartPayload 同源派生，
 * 把 IPC 侧的 runId 换成进程内的 AbortSignal，并要求已解析好的 sessionId。
 */
/** 主进程从活跃 runId 解析出的会话归属与生命周期信号。 */
export type AgentRunScope = {
  sessionId: string;
  signal: AbortSignal;
};

export type AgentRunOptions = Omit<AgentStartPayload, 'runId' | 'sessionId'> & AgentRunScope;

/** 通用 AgentRuntime 接收的 steer 参数；运行 scope 由主进程登记提供。 */
export type AgentSteerOptions = Omit<AgentSteerPayload, 'runId'> & AgentRunScope;

/**
 * Agent 运行时抽象（原 @chaptale/agent-core）。
 *
 * desktop 由 pi SDK 实现；未来其他端可由 HTTP/WebSocket/native runtime 实现。
 * 不包含 Electron、Node fs 或 pi SDK 类型。
 */
export interface AgentRuntime {
  /** 启动并产出一条 Agent 消息流。 */
  stream(options: AgentRunOptions): AsyncGenerator<ChatMessage>;
  /** 向当前活跃运行追加 steering message。 */
  steer(options: AgentSteerOptions): Promise<void>;
  /** 清空指定活跃运行中仍未消费的 steering 与 follow-up 消息。 */
  clearPendingMessages(scope: AgentRunScope): Promise<AgentClearedQueue>;
  /** 查询当前会话水位；达到产品阈值时由 Renderer 提示作者。 */
  getContextPressure(sessionId: string): Promise<MemoryContextPressureStatus>;
  /** 作者确认后压缩会话，并把摘要镜像落入 memory。 */
  compactSession(sessionId: string): Promise<MemoryCompactionResult>;
}
