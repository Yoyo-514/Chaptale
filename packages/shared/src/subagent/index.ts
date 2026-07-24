/** 子任务槽位的生命周期状态：queued → running → 终态四选一。 */
export type SubagentState = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout';

/** 单次子任务的 token 消耗；由执行器返回，池聚合后随事件上报。 */
export type SubagentUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** 槽位状态机事件：每次状态迁移推送一条，终态附带 usage/结果引用/错误信息。 */
export type SubagentSlotEvent = {
  requestId: string;
  personaId: string;
  /** 发起委派的宿主会话；UI 据此过滤自己关心的子任务。 */
  sessionId?: string;
  state: SubagentState;
  usage?: SubagentUsage;
  /** 终态时的落盘引用；UI 据此读取并展示结果正文（双通道之一）。 */
  runId?: string;
  outputRef?: string;
  error?: string;
};

/** 活跃槽位快照：窗口重开后 UI 恢复展示用。 */
export type SubagentSlotSnapshot = {
  requestId: string;
  personaId: string;
  sessionId?: string;
  state: SubagentState;
};

/** 终态状态集合：进入即不再迁移。 */
export const SUBAGENT_TERMINAL_STATES: readonly SubagentState[] = ['success', 'failed', 'cancelled', 'timeout'];
