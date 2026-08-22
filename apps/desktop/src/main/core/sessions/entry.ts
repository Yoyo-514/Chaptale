import type { ChaptaleSessionScope } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';

/**
 * 自有会话存储条目类型。
 *
 * 消息载荷采用 OpenAI Chat Messages 形状（AI SDK ModelMessage 兼容子集）：
 * store、engine、gateway 三方共用同一形状，映射层归零。
 * 与 @chaptale/shared 的 ChatMessage 是两个独立类型，互不波及。
 */

export type SessionHeader = {
  type: 'chaptale-session';
  version: 1;
  id: string;
  timestamp: string;
  cwd: string;
};

export type SessionTextPart = {
  type: 'text';
  text: string;
};

/** 图片以 base64 内联；与 OpenAI image_url 的 data URL 同构，便于四协议网关直出。 */
export type SessionImagePart = {
  type: 'image';
  mimeType: string;
  /** base64 编码字节，不含 data URL 前缀。 */
  data: string;
};

export type SessionContentPart = SessionTextPart | SessionImagePart;

export type SessionToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type SessionMessage =
  | {
      role: 'user';
      content: string | SessionContentPart[];
      contextFiles?: ChatContextFile[];
    }
  | {
      role: 'assistant';
      content?: string | SessionContentPart[];
      /** 思维链（reasoning 模型；不进模型回放，仅供 UI 展示）。 */
      reasoning?: string;
      toolCalls?: SessionToolCall[];
      usage?: SessionUsage;
    }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      /** 工具原始输出（execute 返回值原样；转模型消息时才归一化为 AI SDK 标签联合）。 */
      output: unknown;
      /**
       * 失败标记：工具抛错、参数非法、或运行中断后补的合成结果。
       *
       * 缺省视为成功——历史文件写于本字段之前，不做迁移。
       */
      isError?: boolean;
      /**
       * 这条结果是补位而非工具产出：调用发出去了，运行却中断在它跑完之前。
       *
       * 与 isError 并存而不是取代它——模型那边只有「有没有可用结果」这一个区分，
       * 补位仍要标成 error，否则它会当成工具真的返回了这段文字；
       * 作者要的却是另一个区分：是我按了停止，还是它自己坏了。
       */
      interrupted?: boolean;
    }
  | { role: 'system'; content: string };

export type SessionEntryBase = {
  id: string;
  /** 父 entry；根 entry 为 null。 */
  parentId: string | null;
  timestamp: string;
};

export type SessionMessageEntry = SessionEntryBase & {
  type: 'message';
  message: SessionMessage;
};

export type SessionModelChangeEntry = SessionEntryBase & {
  type: 'model_change';
  provider: string;
  modelId: string;
};

export type SessionCompactionEntry = SessionEntryBase & {
  type: 'compaction';
  summary: string;
  /** 压缩后保留的首个 entry；它之前的 message 折叠进 summary。 */
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
};

/**
 * 引擎替模型收尾的原因。
 *
 * 只收护栏截停这三种：模型自己说完（`natural`）是常态，每轮都记一笔只是噪音；
 * 用户取消在界面上另有表达，也不占这里的位置。
 *
 * 有意与 IPC 契约的 `RunStopReason` 各自定义而非派生：落盘的是历史事实，
 * 契约日后增删取值不该让旧文件读不出来。两侧对齐由写入侧那次赋值兜住——
 * 取值一旦漂移，把停因赋进本字段时即编译失败。
 */
export const SESSION_RUN_STOP_REASONS = ['step-limit', 'token-budget', 'output-truncated'] as const;

export type SessionRunStopReason = (typeof SESSION_RUN_STOP_REASONS)[number];

/** 历史文件里的取值未经校验（reader 只认 id/parentId），出核心层前据此挡掉脏值。 */
export function isSessionRunStopReason(value: unknown): value is SessionRunStopReason {
  return typeof value === 'string' && (SESSION_RUN_STOP_REASONS as readonly string[]).includes(value);
}

/**
 * 一轮运行被护栏截停的记录。
 *
 * 单独成条而不是挂在最后那条 assistant 消息上：停因是**运行级**事实，
 * 一轮跨多步多条消息，挂到其中一条本就错位；`step-limit` 更是压根不对应
 * 任何一步的结束。何况停因的判定发生在该步落盘**之后**（落盘先于一切判断
 * 是刻意的），届时那条消息早已 append，append-only 改不回去。
 */
export type SessionRunStopEntry = SessionEntryBase & {
  type: 'run_stop';
  reason: SessionRunStopReason;
};

/** leaf 切换入流；targetId 为 null 表示回到自然 leaf（最后一条 entry）。 */
export type SessionBranchSelectedEntry = SessionEntryBase & {
  type: 'branch_selected';
  targetId: string | null;
};

export type SessionSessionInfoEntry = SessionEntryBase & {
  type: 'session_info';
  name?: string;
};

export type SessionLabelEntry = SessionEntryBase & {
  type: 'label';
  targetId: string;
  label?: string;
};

/** 预留扩展位（todo 快照等）；读取方按 customType 分发，未知类型原样保留。 */
export type SessionCustomEntry = SessionEntryBase & {
  type: 'custom';
  customType: string;
  data: unknown;
};

export type SessionEntry =
  | SessionMessageEntry
  | SessionModelChangeEntry
  | SessionCompactionEntry
  | SessionRunStopEntry
  | SessionBranchSelectedEntry
  | SessionSessionInfoEntry
  | SessionLabelEntry
  | SessionCustomEntry;

/** 文件中的一行：首行 header，其后逐行 entry。 */
export type SessionFileLine = SessionHeader | SessionEntry;

/** 会话文件解析后的完整快照。 */
export type ParsedSessionFile = {
  header: SessionHeader;
  entries: SessionEntry[];
  /**
   * 中间坏行计数。
   *
   * 单写者 append-only 下写完的行不会再被碰，所以这个数一旦非零就意味着有外因
   * 动过文件（手工编辑、同步冲突、坏块）。后果不止「少一条」：丢掉的 entry 会让
   * parentId 链断在那里，回溯与上下文构建都在断点停住，更早的历史既显示不出来，
   * 也进不了模型。
   */
  skippedMidLines: number;
  /** 末行截断跳过计数：写到一半掉电的正常损耗，丢的是最后那条刚落的 entry。 */
  skippedTailLines: number;
};

/** 列表项推导所需的会话级摘要。 */
export type SessionSummary = {
  id: string;
  cwd: string;
  createdAt: string;
  name?: string;
  updatedAt: string;
  leafId: string | null;
  messageCount: number;
  lastMessagePreview?: string;
  totalTokens: number;
  scope: ChaptaleSessionScope;
  /**
   * 文件里读不回来的记录数；无损坏时不带此字段。
   *
   * 只计中间坏行——末行截断是单写者 append-only 下的正常损耗，界面上「最后一句没了」
   * 本身就是表达。哪一类该报警是本层的判断，不把两个数一起丢给渲染层去挑。
   */
  damagedEntryCount?: number;
};
