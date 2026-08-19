import type { ChaptaleSessionScope } from '@chaptale/ipc-contract';

/**
 * 自有会话存储 v1 条目类型。
 *
 * 消息载荷采用 OpenAI Chat Messages 形状（AI SDK ModelMessage 兼容子集）：
 * store、engine、gateway 三方共用同一形状，映射层归零。
 * 与 @chaptale/shared 的 ChatMessage 是两个独立类型——P2-d 切换时才统一，此前互不波及。
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
      contextFiles?: import('@chaptale/shared').ChatContextFile[];
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
  /** 中间坏行计数（跳过；进 storage debug info）。 */
  skippedMidLines: number;
  /** 末行截断跳过计数（崩溃保护）。 */
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
};
