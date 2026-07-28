/** persona 执行形态：chat 挂在主对话，task 是独立子任务会话。 */
export type AgentRunExecution = 'chat' | 'task';

/** 触发来源：作者直接发起 / 其他 agent 委派 / UI 按钮等界面动作。 */
export type AgentRunTrigger = 'user' | 'delegate' | 'ui-action';

/** 终态集合；运行中的登记不落盘，只有终态记录进 JSONL。 */
export type AgentRunStatus = 'success' | 'failed' | 'cancelled' | 'timeout';

/** 输入摘要：只存指纹级信息（简述 + 文件清单），完整输入不内联。 */
export type AgentRunInputDigest = {
  brief?: string;
  files?: string[];
  packId?: string;
};

/** token 消耗统计，用于成本复盘与 usage 汇总。 */
export type AgentRunUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * 单次 persona 执行的可追溯记录。
 *
 * 目标是回答"当时用了什么提示词、读了哪些记忆、产出在哪、花了多少 token"：
 * - promptTemplateHash 锁定 persona 文件当时的内容指纹；
 * - memoryRefs 记录本次读取的记忆文件（含 updatedAt 标记）；
 * - 大输出落独立文件，记录里只留 outputRef 相对路径。
 */
export type AgentRunRecord = {
  id: string;
  personaId: string;
  execution: AgentRunExecution;
  trigger: AgentRunTrigger;
  /** 委派/界面动作发起时，指向宿主主对话 session。 */
  parentSessionId?: string;
  promptTemplateHash: string;
  inputDigest: AgentRunInputDigest;
  /** 输出体的 workspace 相对路径（由 store.saveOutput 生成）。 */
  outputRef?: string;
  memoryRefs: string[];
  status: AgentRunStatus;
  usage: AgentRunUsage;
  /** ISO 8601 时间串；同时决定记录归入哪个月份的 JSONL 文件。 */
  createdAt: string;
  completedAt?: string;
};
