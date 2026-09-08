import type { Static } from 'typebox';

import type { WorkspaceLayout } from '@chaptale/shared';

import type {
  CreateEntryArgsSchema,
  CreateWorkspaceArgsSchema,
  EntryPathArgsSchema,
  MutateEntryArgsSchema,
  ListDirectoryArgsSchema,
  ReadDocumentArgsSchema,
  WriteDocumentArgsSchema,
  CreateChapterArgsSchema,
  WorkspaceChangedSchema,
  RecoveryPathArgsSchema,
  SaveRecoveryArgsSchema,
  RecoveryDraftSchema
} from './schemas/workspace';

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type WorkspaceState = { rootPath: string | null; displayName: string | null; hasChaptaleMetadata: boolean };
export type CreateWorkspaceArgs = Static<typeof CreateWorkspaceArgsSchema>;
export type CreateWorkspaceResult =
  | { ok: true; rootPath: string; firstDocument: string; files: string[] }
  | { ok: false; message: string; partialPath?: string };
export type ListDirectoryArgs = Static<typeof ListDirectoryArgsSchema>;
export type DirectoryEntry = {
  name: string;
  kind: 'file' | 'directory';
  relativePath: string;
  size?: number;
  mtimeMs?: number;
};
export type ListDirectoryResult =
  | { ok: true; entries: DirectoryEntry[] }
  | {
      ok: false;
      code: 'not-found' | 'not-a-directory' | 'outside-workspace' | 'read-failed' | 'no-workspace';
      message: string;
    };

export type CreateEntryArgs = Static<typeof CreateEntryArgsSchema>;
/** 新建结果回传创建出的条目，Renderer 据此定位并选中，无需再猜排序位置。 */
export type CreateEntryResult =
  | { ok: true; entry: DirectoryEntry }
  | {
      ok: false;
      code: 'already-exists' | 'invalid-name' | 'outside-workspace' | 'no-workspace' | 'write-failed';
      message: string;
    };

export type ReadDocumentArgs = Static<typeof ReadDocumentArgsSchema>;
export type DocumentHead =
  | { status: 'ok'; frontmatter: Record<string, unknown>; body: string }
  | { status: 'none'; body: string }
  | { status: 'invalid'; body: string; error: string };

export type WorkspaceDocument = {
  rootPath: string;
  relativePath: string;
  /** 完整 UTF-8 原文，保留 BOM、frontmatter 与原始换行；head 只是一份解析投影。 */
  content: string;
  head: DocumentHead;
  sizeBytes: number;
  mtimeMs: number;
  /** 对实际读取的原始字节计算 SHA-256，不对解析或换行归一化后的文本计算。 */
  contentHash: string;
};

export type ReadDocumentErrorCode =
  | 'no-workspace'
  | 'workspace-changed'
  | 'outside-workspace'
  | 'not-found'
  | 'not-a-file'
  | 'binary-file'
  | 'unsupported-encoding'
  | 'too-large'
  | 'file-changed'
  | 'read-timeout'
  | 'read-failed';

export type ReadDocumentResult =
  | { ok: true; document: WorkspaceDocument }
  | { ok: false; code: ReadDocumentErrorCode; message: string };

export type WriteDocumentArgs = Static<typeof WriteDocumentArgsSchema>;
export type WriteDocumentResult =
  | { ok: true; document: WorkspaceDocument }
  | { ok: false; code: ReadDocumentErrorCode | 'conflict' | 'invalid-content' | 'write-failed'; message: string };
export type WorkspaceLayoutResult = { ok: true; layout: WorkspaceLayout } | { ok: false; message: string };
export type CreateChapterArgs = Static<typeof CreateChapterArgsSchema>;
export type WorkspaceChanged = Static<typeof WorkspaceChangedSchema>;
export type RecoveryPathArgs = Static<typeof RecoveryPathArgsSchema>;
export type SaveRecoveryArgs = Static<typeof SaveRecoveryArgsSchema>;
export type RecoveryDraft = Static<typeof RecoveryDraftSchema>;
export type RecoverySummary = Omit<RecoveryDraft, 'content'>;
export type EntryPathArgs = Static<typeof EntryPathArgsSchema>;
export type MutateEntryArgs = Static<typeof MutateEntryArgsSchema>;
export type WorkspaceEntryInfo = {
  relativePath: string;
  kind: 'file' | 'directory';
  version: string;
  entries: number;
  protectedReason?: string;
};
export type InspectEntryResult = { ok: true; entry: WorkspaceEntryInfo } | { ok: false; message: string };
export type MutateEntryResult = { ok: true; relativePath?: string } | { ok: false; message: string };
