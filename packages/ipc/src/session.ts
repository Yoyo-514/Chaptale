import type { Static } from 'typebox';

import type { ChatMessage } from '@chaptale/shared';

import type { RunStopRecordReason } from './agent';
import type {
  CreateSessionOptionsSchema,
  DeleteSessionPayloadSchema,
  DeleteSessionsPayloadSchema,
  ExportSessionPayloadSchema,
  ReadSessionImagePayloadSchema,
  RenameSessionPayloadSchema,
  SetSessionLeafPayloadSchema
} from './schemas/sessions';
import type { ChaptaleStorageMode } from './settings';

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

/** v1 会话树节点（与 core/sessions entry 同形状；未知类型以 custom 透传）。 */
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
};

export type ChaptaleModelChangeEntry = ChaptaleSessionTreeEntryBase & {
  type: 'model_change';
  provider: string;
  modelId: string;
};

/** 本轮被护栏截停的记录；模型自然收尾与用户取消都不产生此节点。 */
export type ChaptaleRunStopEntry = ChaptaleSessionTreeEntryBase & {
  type: 'run_stop';
  reason: RunStopRecordReason;
};

export type ChaptaleBranchSelectedEntry = ChaptaleSessionTreeEntryBase & {
  type: 'branch_selected';
  targetId: string | null;
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

/**
 * Renderer 可识别的会话树节点联合（v1）。
 */
export type ChaptaleSessionTreeEntry =
  | ChaptaleMessageEntry
  | ChaptaleCompactionEntry
  | ChaptaleModelChangeEntry
  | ChaptaleRunStopEntry
  | ChaptaleBranchSelectedEntry
  | ChaptaleLabelEntry
  | ChaptaleSessionInfoEntry
  | ChaptaleCustomEntry;

export type ChaptaleSessionMetadata = {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
};

/** 会话存储范围：与设置里的存储模式同源（'global' | 'workspace'）。 */
export type ChaptaleSessionScope = ChaptaleStorageMode;

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
  /**
   * 会话文件里读不回来的记录数；文件完好时不带此字段。
   *
   * 丢掉的记录会让树上的父子链断在那里，断点更早的历史既显示不出来也进不了模型，
   * 所以这不是「少一条」而是「少一段」。
   */
  damagedEntryCount?: number;
};

export type CreateSessionOptions = Static<typeof CreateSessionOptionsSchema>;

export type RenameSessionPayload = Static<typeof RenameSessionPayloadSchema>;

export type ExportSessionPayload = Static<typeof ExportSessionPayloadSchema>;

export type DeleteSessionPayload = Static<typeof DeleteSessionPayloadSchema>;

export type DeleteSessionsPayload = Static<typeof DeleteSessionsPayloadSchema>;

export type SetSessionLeafPayload = Static<typeof SetSessionLeafPayloadSchema>;

/** 图片原图可来自持久化会话块或当前本地上下文文件，两种来源由判别字段隔离。 */
export type ReadSessionImagePayload = Static<typeof ReadSessionImagePayloadSchema>;

/** 跨 IPC 返回可结构化克隆的字节数组，避免把 Node Buffer 暴露给 Renderer。 */
export type ReadSessionImageResult = {
  data: Uint8Array;
  mimeType: string;
};

export type ChaptaleSessionStorageDebugInfo = {
  rootDir: string;
  sessionDir: string;
  cwd: string;
  storageMode?: ChaptaleStorageMode;
  workspacePath?: string;
};
