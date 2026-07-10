import type { ChatImageSource, ChatMessage } from '@chaptale/shared';

export type ChaptaleSessionEntry = {
  type: 'session';
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

export type ChaptaleSessionTreeEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

export type ChaptaleMessageEntry = ChaptaleSessionTreeEntryBase & {
  type: 'message';
  message: ChatMessage;
};

export type ChaptaleCompactionEntry<T = unknown> = ChaptaleSessionTreeEntryBase & {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
};

export type ChaptaleBranchSummaryEntry<T = unknown> = ChaptaleSessionTreeEntryBase & {
  type: 'branch_summary';
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
};

export type ChaptaleLabelEntry = ChaptaleSessionTreeEntryBase & {
  type: 'label';
  targetId: string;
  label?: string;
};

export type ChaptaleSessionInfoEntry = ChaptaleSessionTreeEntryBase & {
  type: 'session_info';
  name?: string;
};

export type ChaptaleCustomEntry<T = unknown> = ChaptaleSessionTreeEntryBase & {
  type: 'custom';
  name: string;
  data: T;
};

export type ChaptaleCustomMessageEntry<T = unknown> = ChaptaleSessionTreeEntryBase & {
  type: 'custom_message';
  message: ChatMessage;
  data?: T;
};

export type ChaptaleSessionTreeEntry =
  | ChaptaleMessageEntry
  | ChaptaleCompactionEntry
  | ChaptaleBranchSummaryEntry
  | ChaptaleLabelEntry
  | ChaptaleSessionInfoEntry
  | ChaptaleCustomEntry
  | ChaptaleCustomMessageEntry;

export type ChaptaleSessionMetadata = {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
};

export type ChaptaleSessionScope = 'global' | 'workspace';

export type ChaptaleSessionListItem = ChaptaleSessionMetadata & {
  name?: string;
  updatedAt: string;
  leafId: string | null;
  messageCount: number;
  lastMessagePreview?: string;
  /** 会话存储范围：全局目录或当前工作区目录 */
  scope: ChaptaleSessionScope;
  /** 会话内 assistant 消息累计 token 消耗 */
  totalTokens: number;
  /** 会话内 assistant 消息累计费用（美元） */
  totalCost: number;
};

export type CreateSessionOptions = {
  id?: string;
  name?: string;
  cwd?: string;
  parentSessionPath?: string;
};

export type RenameSessionPayload = {
  sessionId: string;
  name: string;
};

export type ExportSessionPayload = {
  sessionId: string;
};

export type DeleteSessionPayload = {
  sessionId: string;
};

export type DeleteSessionsPayload = {
  sessionIds: string[];
};

export type SetSessionLeafPayload = {
  sessionId: string;
  leafId: string | null;
};

export type ReadSessionImagePayload = ChatImageSource;

export type ReadSessionImageResult = {
  data: Uint8Array;
  mimeType: string;
};

export type ChaptaleSessionStorageDebugInfo = {
  rootDir: string;
  sessionDir: string;
  cwd: string;
  storageMode?: 'global' | 'workspace';
  workspacePath?: string;
};
