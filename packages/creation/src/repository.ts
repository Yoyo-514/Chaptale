import type {
  DeliveryGroup,
  CreationChanges,
  CreationCursor,
  CreationEvent,
  CreationSnapshot,
  Document,
  DocumentSearchPage,
  SearchDocumentsInput,
  DraftState,
  Entry,
  EntrySnapshot,
  RecoveryDraft,
  PendingChange,
  DecideReviewInput,
  DecideDeliveryInput,
  RecordSnapshot,
  RelationSnapshot,
  StoryRelation,
  SessionAssignment,
  SessionSelection,
  SessionState,
  Revision,
  StoryRecord,
  RevisionSummary,
  TrashBatch,
  TrashedWork,
  Work,
  WorkbenchState
} from './contracts.ts';

/** 回执中的事件描述复用结果元数据，避免重复保存条目。 */
export type CommitEffect =
  | { kind: 'work' }
  | { kind: 'library' }
  | { kind: 'entry' }
  | { kind: 'entries' }
  | { kind: 'review' }
  | { kind: 'delivery' }
  | { kind: 'record'; removed: boolean }
  | { kind: 'records' }
  | { kind: 'relation'; removed: boolean }
  | { kind: 'move'; from: { parentId: string | null; position: number } };

export type CommitResult =
  | Work
  | Entry
  | Entry[]
  | PendingChange
  | DeliveryGroup
  | StoryRecord
  | StoryRelation
  | { count: number };

/** 事件的一次修订；顺序不进入修订。 */
export interface RecordRevision {
  id: string;
  recordId: string;
  parentRevisionId: string | null;
  source: Revision['source'];
  snapshot: RecordSnapshot;
  createdAt: number;
}

/** 关系的一次修订，保存连同建立／结束的整份快照。 */
export interface RelationRevision {
  id: string;
  relationId: string;
  parentRevisionId: string | null;
  source: Revision['source'];
  snapshot: RelationSnapshot;
  createdAt: number;
}

export interface CommandCommit<T> {
  result: T;
  event: CreationEvent;
  fresh: boolean;
}

/** 本机库 library.sqlite：作品列表、会话归属、工作台、待审修改、交付进度、提交意图与恢复草稿。 */
export interface LibraryRepository {
  /** 回调同步执行，内部读写共用本机库事务。 */
  transaction<T>(apply: () => T): T;

  /** 正常作品库中的作品；回收站中的作品不算。 */
  hasWork(workId: string): boolean;
  insertWork(work: Work): void;
  /** 覆盖导入时换上作品包里的标题与类型。 */
  updateWork(work: Work): void;
  listWorks(): Work[];
  listTrashedWorks(): TrashedWork[];
  getTrashedWork(workId: string): TrashedWork | undefined;
  trashWork(workId: string, now: number): void;
  restoreWork(workId: string): void;
  /** 删除作品库中该作品的记录与会话归属，待审修改移出交付组。 */
  purgeWork(workId: string): void;

  readSessionState(): SessionState;
  getSessionWork(sessionId: string): string | null;
  assignSession(assignment: SessionAssignment): void;
  selectSession(selection: SessionSelection): void;
  forgetSessions(sessionIds: string[]): void;
  readWorkbench(): WorkbenchState;
  writeWorkbench(state: WorkbenchState): void;

  getCurrentDelivery(sessionId: string): DeliveryGroup | undefined;
  /** 按新到旧排列。 */
  listDeliveryGroups(sessionId: string): DeliveryGroup[];
  getDeliveryGroup(id: string): DeliveryGroup | undefined;
  putDeliveryGroup(group: DeliveryGroup): void;

  getPendingChange(id: string): PendingChange | undefined;
  listPendingChanges(workId: string | null, sessionId: string | null): PendingChange[];
  putPendingChange(change: PendingChange): void;
  putReviewIntent(input: DecideReviewInput): void;
  listReviewIntents(): DecideReviewInput[];
  clearReviewIntent(commandId: string): void;
  putDeliveryIntent(input: DecideDeliveryInput): void;
  listDeliveryIntents(): DecideDeliveryInput[];
  clearDeliveryIntent(commandId: string): void;

  getDraftState(workId: string, documentId: string): DraftState;
  putDraft(draft: RecoveryDraft): void;
  clearDraft(workId: string, documentId: string, draftId: string): void;
  clearDrafts(workId: string, documentIds: readonly string[]): void;
}

/** 一部作品的 work.sqlite：正式条目、修订、检索、回收站与命令回执。 */
export interface WorkRepository {
  readonly workId: string;
  readReceipt<T>(commandId: string, parameters: readonly unknown[]): T | undefined;

  getEntry(entryId: string): Entry | undefined;
  listEntries(): Entry[];
  nextPosition(section: Entry['section'], parentId: string | null): number;
  insertEntry(snapshot: Revision['snapshot'], revision: Revision): void;
  updateDocument(document: Document, revision: Revision): void;
  /** 目录与文件条目改名。 */
  updateTitle(snapshot: Revision['snapshot'], revision: Revision): void;
  relocateEntry(entry: Entry, parentId: string | null, position: number): void;
  getDocument(documentId: string): Document | undefined;
  /** 文件条目独占的目录，存放添加时复制的文件。 */
  entryFileDir(entryId: string): string;
  /** candidates 覆盖正式正文，hidden 为会话中待删除、不参与检索的条目。 */
  searchDocuments(
    input: SearchDocumentsInput,
    candidates?: readonly EntrySnapshot[],
    hidden?: readonly string[]
  ): DocumentSearchPage;
  getRevision(revisionId: string): Revision | undefined;
  /** 正文与前一修订不同的修订，最新在前。 */
  listRevisions(entryId: string): RevisionSummary[];
  getRevisionEntryId(revisionId: string): string | undefined;

  /** 条目及其正常子项记为同一删除批次，返回进入回收站的全部条目 ID。 */
  trashEntries(rootIds: readonly string[], batchId: string, now: number): string[];
  listTrash(): TrashBatch[];
  isTrashed(entryId: string): boolean;
  getTrashedDocument(documentId: string): Document | undefined;
  getTrashedEntry(entryId: string): Entry | undefined;
  /** 返回恢复到正常目录的条目 ID。 */
  restoreTrash(batchId: string): string[];
  /** 返回被永久删除条目的元数据。 */
  purgeTrash(batchId: string): Entry[];
  listTrashBatchIds(): string[];

  /** 不在回收站中的事件，按发生位置与顺序排列。 */
  listRecords(): StoryRecord[];
  getRecord(recordId: string): StoryRecord | undefined;
  /**
   * 写入事件的新修订。新事件或发生位置改变时排到新位置末尾，原位置的后续事件前移；返回写入后的事件。
   */
  saveRecord(snapshot: RecordSnapshot, revision: RecordRevision): StoryRecord;
  /** 插到 beforeId 之前，beforeId 为 null 时排到末尾；两者须在同一发生位置。 */
  moveRecord(recordId: string, beforeId: string | null): StoryRecord;
  /** 单个事件移入回收站，自成一个删除批次。 */
  trashRecord(recordId: string, batchId: string, now: number): void;
  isRecordTrashed(recordId: string): boolean;

  /** 不在回收站中的关系。 */
  listRelations(): StoryRelation[];
  getRelation(relationId: string): StoryRelation | undefined;
  /** 写入关系的新修订，建立／结束按快照整体替换；返回写入后的关系。 */
  saveRelation(snapshot: RelationSnapshot, revision: RelationRevision): StoryRelation;
  /** 单条关系移入回收站，自成一个删除批次。 */
  trashRelation(relationId: string, batchId: string, now: number): void;
  isRelationTrashed(relationId: string): boolean;
  /** 建立／结束随出处章节进入回收站；关系保存时不再列出它们。 */
  trashMilestones(milestoneIds: readonly string[], batchId: string, now: number): void;
  hasTrashedStart(relationId: string): boolean;
}

/**
 * 业务所需的持久化操作，按数据库分为本机库与作品库；两库各自提交，跨库顺序由应用服务凭回执协调。
 * command 的回调同步执行，修改与回执共用对应数据库事务。
 */
export interface CreationRepository {
  readonly library: LibraryRepository;
  work(workId: string): WorkRepository;
  command<T extends CommitResult>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): CommandCommit<T>;
  snapshot(workId: string | null): CreationSnapshot;
  readChanges(cursor: CreationCursor, limit: number): CreationChanges;
  /** 关闭作品数据库连接，返回仍存在的作品目录。 */
  releaseWork(workId: string): string[];
  /** 把作品库快照与资料文件写成作品包。 */
  exportWorkPackage(workId: string, file: string): void;
  /** 读取作品包里的作品信息；不是作品包或版本过新时报错。 */
  readWorkPackage(file: string): Work;
  /** 展开作品包为 workId 的作品目录；replace 时原目录留作恢复快照并返回其路径。 */
  installWorkPackage(file: string, workId: string, replace: boolean): string | null;
  close(): void;
}
