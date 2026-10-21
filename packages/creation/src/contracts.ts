import type { RpcClient, RpcCommand } from '@chaptale/contracts';

/** 作品契约独立于 Node、SQLite、Electron 与 pi，可直接用于界面和传输。 */
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
  source: 'author';
  snapshot: Entry & { content: string | null };
  createdAt: number;
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

export interface RecoveryDraft extends Omit<SaveDocumentInput, 'commandId'> {
  /** 此快照正式保存时沿用该 ID 作为命令 ID。 */
  id: string;
  updatedAt: number;
}

export interface DraftState {
  version: string | null;
  draft: RecoveryDraft | null;
}

export type WriteDraftInput = Omit<RecoveryDraft, 'id' | 'updatedAt'> & {
  draftId: string;
  expectedDraftVersion: string | null;
};

/** 游标属于作品库（workId=null）或单部作品；token 标识具体提交，识别恢复后的分叉。 */
export interface CreationCursor {
  workId: string | null;
  sequence: number;
  token: string | null;
}

export type CreationSnapshot =
  | { kind: 'library'; cursor: CreationCursor; works: Work[] }
  | { kind: 'work'; workId: string; cursor: CreationCursor; entries: Entry[] };

export type CreationChange =
  | { kind: 'work'; work: Work }
  | { kind: 'entry'; entry: Entry }
  | { kind: 'move'; entry: Entry; from: { parentId: string | null; position: number } };

export interface CreationEvent {
  cursor: CreationCursor;
  commandId: string;
  committedAt: number;
  change: CreationChange;
}

export type CreationChanges =
  | { kind: 'changes'; cursor: CreationCursor; events: CreationEvent[]; hasMore: boolean }
  | { kind: 'snapshot-required' };

export type CreationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CreationError | { code: 'invalid-request' | 'failed'; message: string } };

export interface CreationCommands {
  createWork: { input: CreateWorkInput; output: CreationResult<Work> };
  createEntry: { input: CreateEntryInput; output: CreationResult<Entry> };
  saveDocument: { input: SaveDocumentInput; output: CreationResult<Entry> };
  readDocument: { input: { workId: string; documentId: string }; output: CreationResult<Document> };
  renameDirectory: { input: RenameDirectoryInput; output: CreationResult<Entry> };
  moveEntry: { input: MoveEntryInput; output: CreationResult<Entry> };
  writeDraft: { input: WriteDraftInput; output: CreationResult<DraftState> };
  discardDraft: { input: { workId: string; documentId: string; draftId: string }; output: CreationResult<DraftState> };
  readDraftState: { input: { workId: string; documentId: string }; output: CreationResult<DraftState> };
  readRevision: { input: { workId: string; revisionId: string }; output: CreationResult<Revision> };
  snapshot: { input: { workId: string | null }; output: CreationResult<CreationSnapshot> };
  readChanges: { input: { cursor: CreationCursor; limit: number }; output: CreationResult<CreationChanges> };
}
export type CreationCommand = RpcCommand<CreationCommands>;
export type CreationClient = RpcClient<CreationCommands, CreationEvent>;

export type CreationError =
  | { code: 'revision-conflict'; message: string; expectedRevisionId: string; actualRevisionId: string }
  | { code: 'draft-conflict'; message: string; actualVersion: string | null }
  | { code: 'entry-location-conflict'; message: string; actualParentId: string | null; actualPosition: number };
