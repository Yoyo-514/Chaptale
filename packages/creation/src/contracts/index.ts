import type { RpcClient, RpcCommand } from '@chaptale/contracts';

import type {
  AddFilesInput,
  AddFilesReport,
  CreateEntryInput,
  CreateWorkInput,
  CreationReadCommands,
  CreationResult,
  Document,
  Entry,
  FileLocation,
  MoveEntryInput,
  RenameEntryInput,
  Revision,
  RevisionSummary,
  SaveDocumentInput,
  TrashBatch,
  TrashBatchInput,
  TrashEntriesInput,
  TrashImpact,
  TrashedWork,
  WorkCommandInput,
  Work,
  WriteWritingGuidelinesInput
} from './content.ts';
import type {
  CreateRecordInput,
  MoveRecordInput,
  RemoveRecordInput,
  ConfirmChapterInput,
  SourceReview,
  StoryRecord,
  UpdateRecordInput
} from './records.ts';
import type { CreateRelationInput, RemoveRelationInput, StoryRelation, UpdateRelationInput } from './relations.ts';
import type { PendingChange, ReviewCommands } from './review.ts';

export type * from './content.ts';
export { isImageFile } from './content.ts';
export type * from './review.ts';
export type * from './records.ts';
export { chapterOrder, groupByPlacement, groupRecords } from './records.ts';
export type * from './relations.ts';
export { relationPresets, relationState, relationTypes } from './relations.ts';

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
  | {
      kind: 'work';
      workId: string;
      cursor: CreationCursor;
      writingGuidelines: string;
      entries: Entry[];
      records: StoryRecord[];
      relations: StoryRelation[];
    };
export type CreationChange =
  | { kind: 'work'; work: Work }
  /** 作品进入、离开作品库回收站或被永久清空；客户端重取作品列表。 */
  | { kind: 'library'; work: Work }
  | { kind: 'writingGuidelines'; writingGuidelines: string }
  | { kind: 'review'; change: PendingChange }
  | { kind: 'reviewBatch'; sessionId: string }
  | { kind: 'entry'; entry: Entry }
  /** 一次提交改动多个条目，例如批量接受待审修改；目录位置可能变化，客户端重取快照。 */
  | { kind: 'entries'; entries: Entry[] }
  | { kind: 'move'; entry: Entry; from: { parentId: string | null; position: number } }
  /** removed：事件移入回收站。调整顺序会改变同位置其他事件的序号，客户端重取快照。 */
  | { kind: 'record'; record: StoryRecord; removed: boolean }
  | { kind: 'records' }
  | { kind: 'textReplacement' }
  /** removed：关系移入回收站。 */
  | { kind: 'relation'; relation: StoryRelation; removed: boolean };
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
/** 作品包里的作品；exists 为作品库中已有同一部作品。 */
/** 备份时的条目数。图片属于资料，目录不计入。 */
export type WorkPackageSummary = { manuscripts: number; resources: number; images: number };

/** 一部作品可归档内容的最近改动时间（毫秒）。 */
export type WorkBackupSource = { workId: string; modifiedAt: number };

export interface WorkPackageInfo {
  work: Work;
  exists: boolean;
  summary: WorkPackageSummary;
}
/** 覆盖导入前保留的作品内容；每部作品只保留最新一份。 */
export interface WorkSnapshot {
  workId: string;
  createdAt: number;
}
/** files 为被替换下来、待平台移入系统回收站的作品目录。 */
export interface WorkReplacement {
  work: Work;
  files: string[];
}
export interface ImportWorkPackageInput {
  commandId: string;
  path: string;
  /** 另存为新作品；否则作品已存在时覆盖。 */
  asCopy: boolean;
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

/** 作者的全作品搜索。unsaved 是开着且有未保存输入的文稿在编辑器里的当前文字，代替已保存内容参与搜索。 */
export interface TextSearchInput {
  workId: string;
  pattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  unsaved: { documentId: string; content: string }[];
  /** 给出时每处命中带上替换后的文字，供替换前预览；null 表示只搜索。 */
  replacement: string | null;
}
/** 搜到的一个对象和搜索时它的正式修订；替换按它确认对象没有变过。 */
export interface TextSearchTarget {
  kind: 'entry' | 'record' | 'relation';
  id: string;
  revisionId: string;
}
/**
 * 把 targets 里的对象按同样的搜索选项替换；targets 须对应正式内容，有未保存输入的文稿先保存再取。
 * excluded 是作者划掉、保持原文的命中。
 */
export interface ReplaceTextInput extends Omit<TextSearchInput, 'unsaved' | 'replacement'> {
  commandId: string;
  replacement: string;
  targets: TextSearchTarget[];
  excluded: { id: string; field: 'content' | 'text' | RelationTextMatch['field']; line: number; from: number }[];
}
/** 撤销一次替换：revisions 取自那次替换的回执。 */
export interface UndoReplaceTextInput {
  commandId: string;
  workId: string;
  revisions: ReplaceTextReport['revisions'];
}
/** count 是还原的对象数；替换之后又变过的对象保持现状，列入 skipped。 */
export interface UndoReplaceTextReport {
  count: number;
  skipped: string[];
}
/** count 是替换的处数；skipped 是有待接受修改而没动的对象；revisions 是改过的对象在替换前后的修订。 */
export interface ReplaceTextReport {
  count: number;
  skipped: string[];
  revisions: (TextSearchTarget & { previousRevisionId: string })[];
}
/** 一处命中：line 是从 1 开始的行号，from、to 是命中在这一行里的起止位置；excerpt 是命中附近的文字，excerptFrom 是命中在其中的起点。 */
export interface TextMatch {
  line: number;
  from: number;
  to: number;
  excerpt: string;
  excerptFrom: number;
  /** 搜索带了 replacement 时，这一处替换后的文字。 */
  replacement?: string;
}
/** 关系里命中的是类型，还是第一方、第二方的称呼。 */
export type RelationTextMatch = TextMatch & { field: 'type' | 'firstTitle' | 'secondTitle' };
/** 命中按目录顺序的文稿、资料，再到事件、关系排列；total 是全部命中数，超过返回上限时 truncated 为 true。 */
export interface TextSearchResult {
  /** 包括显示上限以外的命中对象，批量操作按搜索时的修订校验。 */
  targets: TextSearchTarget[];
  entries: { entryId: string; matches: TextMatch[] }[];
  records: { recordId: string; matches: TextMatch[] }[];
  relations: { relationId: string; matches: RelationTextMatch[] }[];
  total: number;
  documentCount: number;
  recordCount: number;
  truncated: boolean;
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
export interface EditorGroupState {
  tabs: (DocumentPosition & { documentId: string })[];
  activeDocumentId: string | null;
}
export type EditorGroupIndex = 0 | 1;
export interface WorkViewState {
  workId: string;
  groups: [EditorGroupState] | [EditorGroupState, EditorGroupState];
  activeGroup: EditorGroupIndex;
  section: Entry['section'];
  manuscript: TreeState;
  resource: TreeState;
}
export interface WorkbenchState {
  activeWorkId: string | null;
  works: WorkViewState[];
}
/** 会话正文、运行状态与作品归属（所在目录）由宿主持有；这里只记录本机查看位置。 */
export interface SessionSelection {
  workId: string | null;
  sessionId: string | null;
}
export interface SessionState {
  selections: SessionSelection[];
}

export interface CreationAuthorCommands extends CreationReadCommands, ReviewCommands {
  readSessionState: { input: Record<string, never>; output: CreationResult<SessionState> };
  selectSession: { input: SessionSelection; output: CreationResult<SessionState> };
  /** 会话删除或改变归属后，清空指向它的查看位置。 */
  forgetSessions: { input: { sessionIds: string[] }; output: CreationResult<SessionState> };
  readWorkbench: { input: Record<string, never>; output: CreationResult<WorkbenchState> };
  writeWorkbench: { input: WorkbenchState; output: CreationResult<WorkbenchState> };
  createWork: { input: CreateWorkInput; output: CreationResult<Work> };
  writeWritingGuidelines: {
    input: WriteWritingGuidelinesInput;
    output: CreationResult<{ writingGuidelines: string }>;
  };
  createEntry: { input: CreateEntryInput; output: CreationResult<Entry> };
  saveDocument: { input: SaveDocumentInput; output: CreationResult<Entry> };
  renameEntry: { input: RenameEntryInput; output: CreationResult<Entry> };
  moveEntry: { input: MoveEntryInput; output: CreationResult<Entry> };
  createRecord: { input: CreateRecordInput; output: CreationResult<StoryRecord> };
  updateRecord: { input: UpdateRecordInput; output: CreationResult<StoryRecord> };
  moveRecord: { input: MoveRecordInput; output: CreationResult<StoryRecord> };
  /** 各章待复核的事件与关系建立／结束。 */
  listSourceReviews: { input: { workId: string }; output: CreationResult<SourceReview[]> };
  /** 本章出处的事件与关系建立／结束绑定所给修订，返回实际改动的数量。 */
  confirmChapter: { input: ConfirmChapterInput; output: CreationResult<{ count: number }> };
  /** 单个事件移入作品回收站。 */
  removeRecord: { input: RemoveRecordInput; output: CreationResult<StoryRecord> };
  createRelation: { input: CreateRelationInput; output: CreationResult<StoryRelation> };
  /** 整条提交；同一发生位置内的顺序按建立或结束的数组顺序。 */
  updateRelation: { input: UpdateRelationInput; output: CreationResult<StoryRelation> };
  /** 单条关系移入作品回收站。 */
  removeRelation: { input: RemoveRelationInput; output: CreationResult<StoryRelation> };
  listTrash: { input: { workId: string }; output: CreationResult<TrashBatch[]> };
  previewTrash: { input: { workId: string; entryIds: string[] }; output: CreationResult<TrashImpact> };
  /** 移入作品回收站并一并拒绝相关待审修改；返回进入回收站的全部条目。 */
  trashEntries: { input: TrashEntriesInput; output: CreationResult<Entry[]> };
  /** 整批恢复，返回恢复后的条目。 */
  restoreTrash: { input: TrashBatchInput & { batchId: string }; output: CreationResult<Entry[]> };
  /** 永久删除，返回被删除的条目。 */
  purgeTrash: { input: TrashBatchInput; output: CreationResult<Entry[]> };
  readTrashedDocument: { input: { workId: string; documentId: string }; output: CreationResult<Document> };
  listTrashedWorks: { input: Record<string, never>; output: CreationResult<TrashedWork[]> };
  /** 删除整部作品时将一并拒绝的待审修改数。 */
  previewTrashWork: { input: { workId: string }; output: CreationResult<{ pendingCount: number }> };
  /** 移入作品库回收站并拒绝该作品全部待审修改；运行中会话的检查由宿主完成。 */
  trashWork: { input: WorkCommandInput; output: CreationResult<Work> };
  restoreWork: { input: WorkCommandInput; output: CreationResult<Work> };
  /** 从作品库移除并清除其查看位置；files 为待平台移入系统回收站的作品目录。 */
  purgeWork: { input: WorkCommandInput; output: CreationResult<{ files: string[] }> };
  writeDraft: { input: WriteDraftInput; output: CreationResult<DraftState> };
  discardDraft: { input: { workId: string; documentId: string; draftId: string }; output: CreationResult<DraftState> };
  readDraftState: { input: { workId: string; documentId: string }; output: CreationResult<DraftState> };
  readRevision: { input: { workId: string; revisionId: string }; output: CreationResult<Revision> };
  /** 作者的全作品搜索，按字面或正则匹配。 */
  searchText: { input: TextSearchInput; output: CreationResult<TextSearchResult> };
  replaceText: { input: ReplaceTextInput; output: CreationResult<ReplaceTextReport> };
  undoReplaceText: { input: UndoReplaceTextInput; output: CreationResult<UndoReplaceTextReport> };
  /** 文稿的正文版本，最新在前。 */
  listRevisions: { input: { workId: string; documentId: string }; output: CreationResult<RevisionSummary[]> };
  snapshot: { input: { workId: string | null }; output: CreationResult<CreationSnapshot> };
  readChanges: { input: { cursor: CreationCursor; limit: number }; output: CreationResult<CreationChanges> };
}
export interface CreationCommands extends CreationAuthorCommands {
  prepareImport: { input: { paths: string[] }; output: CreationResult<ImportPlan> };
  importFiles: { input: ImportFilesInput; output: CreationResult<ImportReport> };
  exportFiles: { input: ExportFilesInput; output: CreationResult<ExportReport> };
  inspectWorkPackage: { input: { path: string }; output: CreationResult<WorkPackageInfo> };
  exportWorkPackage: { input: { workId: string; path: string }; output: CreationResult<null> };
  listWorkBackupSources: { input: Record<string, never>; output: CreationResult<WorkBackupSource[]> };
  /** 覆盖已有作品时拒绝该作品全部待审修改，原内容留作导入前快照；运行中会话的检查由宿主完成。 */
  importWorkPackage: { input: ImportWorkPackageInput; output: CreationResult<WorkReplacement> };
  listWorkSnapshots: { input: Record<string, never>; output: CreationResult<WorkSnapshot[]> };
  /** 换回导入前快照并拒绝该作品全部待审修改；运行中会话的检查由宿主完成。 */
  restoreWorkSnapshot: { input: WorkCommandInput; output: CreationResult<WorkReplacement> };
  addFiles: { input: AddFilesInput; output: CreationResult<AddFilesReport> };
  /** trashed 为 true 时定位回收站中的文件，只用于只读预览。 */
  locateFile: { input: { workId: string; entryId: string; trashed: boolean }; output: CreationResult<FileLocation> };
  /** 创建并返回作品文件目录（资料区文件条目的存放位置），归属该作品的 Agent 会话以它为工作目录。 */
  prepareWorkFiles: { input: { workId: string }; output: CreationResult<string> };
}
export type CreationAuthorCommand = RpcCommand<CreationAuthorCommands>;
export type CreationCommand = RpcCommand<CreationCommands>;
export type CreationClient = RpcClient<CreationCommands, CreationEvent>;
