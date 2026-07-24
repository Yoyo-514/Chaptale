/** 子任务槽位的生命周期状态：queued → running → 终态四选一。 */
export type SubagentState = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout';

/** 单次子任务的 token 消耗；由执行器返回，池聚合后随事件上报。 */
export type SubagentUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** 槽位状态机事件：每次状态迁移推送一条，终态附带 usage/错误信息。 */
export type SubagentSlotEvent = {
  requestId: string;
  personaId: string;
  state: SubagentState;
  usage?: SubagentUsage;
  error?: string;
};

/** 终态状态集合：进入即不再迁移。 */
export const SUBAGENT_TERMINAL_STATES: readonly SubagentState[] = ['success', 'failed', 'cancelled', 'timeout'];
