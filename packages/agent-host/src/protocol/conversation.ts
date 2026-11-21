import type { AgentInstructions, EditMode } from './instructions.ts';
import type { ModelRef } from './models.ts';
import type { SkillInvocationView } from './skills.ts';

/**
 * 原生 JSONL 中保存会话指令与修改模式的自定义记录类型。
 * 这是持久化格式标识，属于存储契约；宿主与历史恢复必须使用同一常量。
 */
export const instructionsEntryType = 'chaptale-agent-instructions';
export const modeEntryType = 'chaptale-edit-mode';
export const branchCursorEntryType = 'chaptale-branch';
export const reviewResultsMessageType = 'chaptale-review-results';

/** 只读历史的原因；lines 是无法解析的 JSONL 行号（从 1 开始）。 */
export interface ReadonlyHistory {
  reason: 'incomplete' | 'damaged' | 'archived';
  message: string;
  lines: number[];
}

/** 发送消息时附带的当前打开标签定位与可选框选原文；正文由 Agent 按需调用 work_read 读取。 */
export interface EditorContext {
  workId: string;
  entryId: string;
  title: string;
  section: 'manuscript' | 'resource';
  selection?: string;
}

/** 工具结果中用于阅读摘要的元数据，正文只通过原始结果传输一次。 */
export interface ToolResultInfo {
  workId?: string;
  entryId?: string;
  title?: string;
  section?: 'manuscript' | 'resource';
  wordCount?: number;
  count?: number;
  description?: string;
  /** 原生只读工具命中已启用技能目录时标记技能名，供界面显示“加载技能《…》”。 */
  skillName?: string;
  /** MCP 工具或资源调用所属服务与短工具名，供界面展示。 */
  mcpServer?: string;
  mcpTool?: string;
  error?: string;
}

/** pi 原生保存的有界子调用记录；详细输出仍属于外层脚本。 */
export interface NestedToolView {
  id: string;
  name: string;
  input?: unknown;
  /** 运行中的摘要字段；原始参数沿用完成后的 SDK 有界记录。 */
  preview?: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'unfinished';
  error?: string;
  info?: ToolResultInfo;
}

export interface ToolCallView {
  id: string;
  name: string;
  input: unknown;
  info?: ToolResultInfo;
  nestedTools?: NestedToolView[];
}

/** 会话树分叉点在当前分支消息上的切换信息（1-based）。 */
export interface MessageBranch {
  index: number;
  total: number;
  prevLeafId?: string;
  nextLeafId?: string;
}

export interface ChatMessage {
  /** 原生 JSONL 条目 ID；流式尚未落盘或损坏行恢复时可能为空。 */
  entryId?: string;
  /** pi 消息角色；`compactionSummary` 为会话压缩总结，`reviewResults` 为作者的逐处处理结果，text 是显示文字。 */
  role: string;
  text: string;
  thinking: string;
  tools: ToolCallView[];
  toolName?: string;
  /** toolResult 对应的原生调用身份，同名调用按此关联。 */
  toolCallId?: string;
  toolInfo?: ToolResultInfo;
  nestedTools?: NestedToolView[];
  nestedToolsComplete?: boolean;
  /** 作者消息关联的编辑上下文（仅在有选区时在气泡上方显示引用块）。 */
  editorContext?: EditorContext;
  /** 作者手动通过 /skill:名称 触发的技能标识，气泡按紧凑标签展示。 */
  skill?: SkillInvocationView;
  /** 该条消息所在分叉点的兄弟分支信息。 */
  branch?: MessageBranch;
  error?: boolean;
  /** 助手轮流式报错时的原始错误信息，供界面提炼主因与展开查看。 */
  errorMessage?: string;
  /** 作者主动停止生成（stopReason: aborted）时为 true，不按错误标红。 */
  aborted?: boolean;
  /** 已被压缩总结代替、不再发送给模型的消息，界面仍可查看。 */
  compacted?: boolean;
  /** reviewResults 的逐条处理结果，如“《第一章》已拒绝”。 */
  outcomes?: { id: string; text: string }[];
}

/** pi 原生自动退避重试的当前状态。 */
export interface RetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

export type SessionNoticeLevel = 'info' | 'error';

/** pi 记录的累计用量；供应商未报告的项目可能记为 0。 */
export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 上下文为估算值；压缩后尚无有效回复时 tokens、percent 为 null。 */
  context?: { tokens: number | null; contextWindow: number; percent: number | null };
}

/** 运行中发出的消息排队方式：steer 在当前步骤后立即插话，followUp 等整轮收尾后继续处理。 */
export type QueuedDelivery = 'steer' | 'followUp';

export interface QueuedMessage {
  delivery: QueuedDelivery;
  text: string;
  editorContext?: EditorContext;
  skill?: SkillInvocationView;
}

export interface SessionView {
  /** 当前打开实例的操作句柄；只读副本具有独立句柄。 */
  id: string;
  /** 本机历史用 pi 原生会话 ID，备份历史按作品和历史名称区分；本机历史头损坏时为空。 */
  sessionId: string | null;
  /** 用户设置的会话名称，保存在 pi 原生 session_info 记录中。 */
  name?: string;
  file: string;
  /** 会话归属的作品，由历史文件所在目录确定；未归属为 null。 */
  workId: string | null;
  model?: ModelRef;
  running: boolean;
  /** 手动或自动压缩期间为 true；running 包含压缩占用。 */
  compacting: boolean;
  /** 只读历史缺少记录时为空列表。 */
  instructions: AgentInstructions;
  mode?: EditMode;
  messages: ChatMessage[];
  /** 已入队但尚未被模型消费的插话与稍后处理消息。 */
  queued?: QueuedMessage[];
  /** 可继续的会话从原生 SDK 读取；只读历史不计算用量。 */
  usage?: SessionUsage;
  error?: string;
  noticeLevel?: SessionNoticeLevel;
  retrying?: RetryState;
  /** 存在时会话只能查看，不能发送、切换模型或修改指令与模式。 */
  readonly?: ReadonlyHistory;
}

export interface HistoryItem {
  id: string;
  file: string;
  /** 历史文件所在目录对应的作品；未归属为 null。 */
  workId: string | null;
  title: string;
  modified: string;
}
