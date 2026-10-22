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

export type ImportSource = {
  sourcePath: string;
  parentIndex: number | null;
  title: string;
} & ({ kind: 'directory'; format: null } | { kind: 'document'; format: Document['format'] });

/** 预览确定本次导入的范围和顺序；重试沿用同一计划及命令身份。 */
export interface ImportPlan {
  commandId: string;
  entries: ImportSource[];
  skippedPaths: string[];
}

export interface ImportFilesInput extends ImportPlan {
  workId: string;
  parentId: string | null;
  section: Entry['section'];
}

/** 按条目提交，失败时明确返回已完成项；原计划可继续重试。 */
export interface ImportReport {
  entries: Entry[];
  failure: { index: number; message: string } | null;
}

export interface ExportFilesInput {
  workId: string;
  directory: string;
  target:
    | { kind: 'document'; documentId: string; format: Document['format'] }
    | { kind: 'manuscript'; format: Document['format'] }
    | { kind: 'book' };
}

export interface ExportReport {
  paths: string[];
  failure: { documentId: string | null; message: string } | null;
}

/** 本机工作台状态只保存身份和位置，正文仍由文档与恢复草稿持有。 */
export interface DocumentPosition {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface TreeState {
  expandedIds: string[];
  selectedId: string | null;
  scrollTop: number;
}

export interface WorkViewState {
  workId: string;
  tabs: (DocumentPosition & { documentId: string })[];
  activeDocumentId: string | null;
  secondaryDocumentId: string | null;
  section: Entry['section'];
  manuscript: TreeState;
  resource: TreeState;
}

export interface WorkbenchState {
  activeWorkId: string | null;
  works: WorkViewState[];
}

/** 会话正文与运行状态由 pi 持有；这里只记录固定归属和本机查看位置。 */
export interface SessionAssignment {
  sessionId: string;
  workId: string;
}
export interface SessionSelection {
  workId: string | null;
  sessionId: string | null;
}
export interface SessionState {
  assignments: SessionAssignment[];
  selections: SessionSelection[];
}

export interface CreationAuthorCommands {
  readSessionState: { input: Record<string, never>; output: CreationResult<SessionState> };
  assignSession: { input: SessionAssignment; output: CreationResult<SessionState> };
  selectSession: { input: SessionSelection; output: CreationResult<SessionState> };
  readWorkbench: { input: Record<string, never>; output: CreationResult<WorkbenchState> };
  writeWorkbench: { input: WorkbenchState; output: CreationResult<WorkbenchState> };
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
export interface CreationCommands extends CreationAuthorCommands {
  prepareImport: { input: { paths: string[] }; output: CreationResult<ImportPlan> };
  importFiles: { input: ImportFilesInput; output: CreationResult<ImportReport> };
  exportFiles: { input: ExportFilesInput; output: CreationResult<ExportReport> };
}

export type CreationAuthorCommand = RpcCommand<CreationAuthorCommands>;
export type CreationCommand = RpcCommand<CreationCommands>;
export type CreationClient = RpcClient<CreationCommands, CreationEvent>;

export type CreationError =
  | { code: 'revision-conflict'; message: string; expectedRevisionId: string; actualRevisionId: string }
  | { code: 'draft-conflict'; message: string; actualVersion: string | null }
  | { code: 'entry-location-conflict'; message: string; actualParentId: string | null; actualPosition: number };
