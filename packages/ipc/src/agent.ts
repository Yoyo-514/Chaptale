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
  RunEndSchema,
  RunStopReasonSchema
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

/** 运行正常收束时的停止原因；用户取消不在此列，它有自己的终态。 */
export type RunStopReason = Static<typeof RunStopReasonSchema>;

/**
 * `stream()` 收束时交还的停因，比 `RunStopReason` 多一个 `aborted`。
 *
 * 取消也要能从这条通道出来：IPC 层据此把它分流到 `cancelled` 终态，
 * 而不是让调用方另找地方判断"这次到底是停了还是被取消了"。
 */
export type AgentRunStopReason = RunStopReason | 'aborted';

/** Main 推送的唯一 Agent 终态事件。 */
export type AgentEndEvent = Static<typeof AgentEndEventSchema>;

export type StreamAgentOptions = Pick<AgentStartPayload, 'branchFromEntryId' | 'contextFilePaths' | 'reuseUserEntryId'>;

/** Preload 发送 steer 时允许附带的应用选项。 */
export type SteerAgentOptions = Pick<AgentSteerPayload, 'contextFilePaths'>;

/** Runtime 清空队列后返回的项目级消息集合，不包含底层 SDK 类型。 */
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
 * desktop 由自有运行时实现；未来其他端可由 HTTP/WebSocket/native runtime 实现。
 * 不包含 Electron、Node fs 或底层 SDK 类型。
 */
export interface AgentRuntime {
  /**
   * 启动并产出一条 Agent 消息流；收束时交还停因。
   *
   * 停因走返回值而非可选回调，是因为它此前正是**被丢在地上**的那个值：
   * 返回值配合 `completed` 终态里必填的 `stopReason`，让漏接直接编译失败。
   */
  stream(options: AgentRunOptions): AsyncGenerator<ChatMessage, AgentRunStopReason>;
  /** 向当前活跃运行追加 steering message。 */
  steer(options: AgentSteerOptions): Promise<void>;
  /** 清空指定活跃运行中仍未消费的 steering 与 follow-up 消息。 */
  clearPendingMessages(scope: AgentRunScope): Promise<AgentClearedQueue>;
  /** 查询当前会话水位；达到产品阈值时由 Renderer 提示作者。 */
  getContextPressure(sessionId: string): Promise<MemoryContextPressureStatus>;
  /** 作者确认后压缩会话，并把摘要镜像落入 memory。 */
  compactSession(sessionId: string): Promise<MemoryCompactionResult>;
}
