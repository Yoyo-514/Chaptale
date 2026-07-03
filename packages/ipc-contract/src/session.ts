import type { ChatMessage } from '@chaptale/shared';

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

export type ChaptaleLeafEntry = ChaptaleSessionTreeEntryBase & {
  type: 'leaf';
  targetId: string | null;
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
  | ChaptaleLeafEntry
  | ChaptaleCustomEntry
  | ChaptaleCustomMessageEntry;

export type ChaptaleSessionMetadata = {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
};

export type ChaptaleSessionListItem = ChaptaleSessionMetadata & {
  name?: string;
  updatedAt: string;
  leafId: string | null;
  messageCount: number;
  lastMessagePreview?: string;
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

export type DeleteSessionPayload = {
  sessionId: string;
};

export type SetSessionLeafPayload = {
  sessionId: string;
  leafId: string | null;
};

export type ChaptaleSessionStorageDebugInfo = {
  rootDir: string;
  sessionDir: string;
  cwd: string;
};
