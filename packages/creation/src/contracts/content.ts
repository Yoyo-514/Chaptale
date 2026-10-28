/** 作品领域的纯数据契约，不依赖 Node、SQLite、Electron 与 pi。 */
export interface Work {
  id: string;
  title: string;
  kind: 'novel' | 'script';
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  id: string;
  parentId: string | null;
  section: 'manuscript' | 'resource';
  kind: 'directory' | 'document';
  title: string;
  position: number;
  format: 'txt' | 'markdown' | null;
  wordCount: number;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Document extends Entry {
  kind: 'document';
  format: 'txt' | 'markdown';
  content: string;
}

export interface Revision {
  id: string;
  entryId: string;
  parentRevisionId: string | null;
  source: 'author' | 'agent' | 'review';
  snapshot: Entry & { content: string | null };
  createdAt: number;
}
export type EntrySnapshot = Revision['snapshot'];

/** 一次删除移入作品回收站的条目；roots 为批次中父目录不在同批次的最外层条目，按原位置排序。 */
export interface TrashBatch {
  id: string;
  deletedAt: number;
  roots: Entry[];
  entryCount: number;
}
export interface TrashEntriesInput {
  commandId: string;
  workId: string;
  entryIds: string[];
}
/** batchId 为 null 时清空整个作品回收站。 */
export interface TrashBatchInput {
  commandId: string;
  workId: string;
  batchId: string | null;
}
/** 删除前在确认框中展示的范围。 */
export interface TrashImpact {
  entryCount: number;
  pendingCount: number;
}

export interface CreateWorkInput {
  commandId: string;
  title: string;
  kind: Work['kind'];
}

export type CreateEntryInput = {
  commandId: string;
  workId: string;
  parentId: string | null;
  section: Entry['section'];
  title: string;
} & ({ kind: 'directory' } | { kind: 'document'; format: Document['format']; content: string });

export interface RenameDirectoryInput {
  commandId: string;
  workId: string;
  directoryId: string;
  expectedRevisionId: string;
  title: string;
}

export interface MoveEntryInput {
  commandId: string;
  workId: string;
  entryId: string;
  expectedParentId: string | null;
  expectedPosition: number;
  parentId: string | null;
  /** 插到该同级条目前；null 表示移到末尾。 */
  beforeEntryId: string | null;
}

export interface SaveDocumentInput {
  commandId: string;
  workId: string;
  documentId: string;
  expectedRevisionId: string;
  title: string;
  format: Document['format'];
  content: string;
}

/** 检索只返回正式条目元数据；正文按文档身份和修订另行读取。 */
export interface SearchDocumentsInput {
  workId: string;
  query: string;
  section?: Entry['section'];
  offset: number;
  limit: number;
}

export interface DocumentSearchPage {
  entries: Entry[];
  hasMore: boolean;
}

export type CreationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CreationError | { code: 'invalid-request' | 'failed'; message: string } };

export type CreationError =
  | { code: 'revision-conflict'; message: string; expectedRevisionId: string; actualRevisionId: string }
  | { code: 'draft-conflict'; message: string; actualVersion: string | null }
  | { code: 'entry-location-conflict'; message: string; actualParentId: string | null; actualPosition: number };

export interface CreationReadCommands {
  listWorks: { input: Record<string, never>; output: CreationResult<Work[]> };
  listEntries: { input: { workId: string }; output: CreationResult<Entry[]> };
  readDocument: { input: { workId: string; documentId: string }; output: CreationResult<Document> };
  searchDocuments: { input: SearchDocumentsInput; output: CreationResult<DocumentSearchPage> };
}
