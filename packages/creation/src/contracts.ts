import type { RpcClient, RpcCommand } from '@chaptale/contracts';

import type {
  CreateEntryInput,
  CreateWorkInput,
  CreationReadCommands,
  CreationResult,
  Document,
  Entry,
  MoveEntryInput,
  RenameDirectoryInput,
  Revision,
  SaveDocumentInput,
  TrashBatch,
  TrashBatchInput,
  TrashEntriesInput,
  TrashImpact,
  Work
} from './contracts/content.ts';
import type { DeliveryGroup, PendingChange, ReviewCommands } from './contracts/review.ts';

export type * from './contracts/content.ts';
export type * from './contracts/review.ts';

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
  | { kind: 'review'; change: PendingChange }
  | { kind: 'delivery'; group: DeliveryGroup }
  | { kind: 'entry'; entry: Entry }
  /** 一次提交改动多个条目，例如整组接受待审修改；目录位置可能变化，客户端重取快照。 */
  | { kind: 'entries'; entries: Entry[] }
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

export interface CreationAuthorCommands extends CreationReadCommands, ReviewCommands {
  readSessionState: { input: Record<string, never>; output: CreationResult<SessionState> };
  assignSession: { input: SessionAssignment; output: CreationResult<SessionState> };
  selectSession: { input: SessionSelection; output: CreationResult<SessionState> };
  /** 会话删除后清除其归属，并清空指向它的查看位置。 */
  forgetSessions: { input: { sessionIds: string[] }; output: CreationResult<SessionState> };
  readWorkbench: { input: Record<string, never>; output: CreationResult<WorkbenchState> };
  writeWorkbench: { input: WorkbenchState; output: CreationResult<WorkbenchState> };
  createWork: { input: CreateWorkInput; output: CreationResult<Work> };
  createEntry: { input: CreateEntryInput; output: CreationResult<Entry> };
  saveDocument: { input: SaveDocumentInput; output: CreationResult<Entry> };
  renameDirectory: { input: RenameDirectoryInput; output: CreationResult<Entry> };
  moveEntry: { input: MoveEntryInput; output: CreationResult<Entry> };
  listTrash: { input: { workId: string }; output: CreationResult<TrashBatch[]> };
  previewTrash: { input: { workId: string; entryIds: string[] }; output: CreationResult<TrashImpact> };
  /** 移入作品回收站并一并拒绝相关待审修改；返回进入回收站的全部条目。 */
  trashEntries: { input: TrashEntriesInput; output: CreationResult<Entry[]> };
  /** 整批恢复，返回恢复后的条目。 */
  restoreTrash: { input: TrashBatchInput & { batchId: string }; output: CreationResult<Entry[]> };
  /** 永久删除，返回被删除的条目。 */
  purgeTrash: { input: TrashBatchInput; output: CreationResult<Entry[]> };
  readTrashedDocument: { input: { workId: string; documentId: string }; output: CreationResult<Document> };
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
