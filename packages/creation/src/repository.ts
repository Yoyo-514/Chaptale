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
  SessionAssignment,
  SessionSelection,
  SessionState,
  Revision,
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
  | { kind: 'move'; from: { parentId: string | null; position: number } };

export type CommitResult = Work | Entry | Entry[] | PendingChange | DeliveryGroup;

export interface CommandCommit<T> {
  result: T;
  event: CreationEvent;
  fresh: boolean;
}

/** 业务所需的持久化操作；事务回调同步执行，修改与回执共用对应数据库事务。 */
export interface CreationRepository {
  libraryTransaction<T>(apply: () => T): T;
  command<T extends CommitResult>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): CommandCommit<T>;
  snapshot(workId: string | null): CreationSnapshot;
  readChanges(cursor: CreationCursor, limit: number): CreationChanges;
  readWorkReceipt<T>(workId: string, commandId: string, parameters: readonly unknown[]): T | undefined;

  hasWork(workId: string): boolean;
  readSessionState(): SessionState;
  getSessionWork(sessionId: string): string | null;
  assignSession(assignment: SessionAssignment): void;
  selectSession(selection: SessionSelection): void;
  forgetSessions(sessionIds: string[]): void;
  readWorkbench(): WorkbenchState;
  writeWorkbench(state: WorkbenchState): void;
  insertWork(work: Work): void;
  listWorks(): Work[];
  getEntry(workId: string, entryId: string): Entry | undefined;
  nextPosition(workId: string, section: Entry['section'], parentId: string | null): number;
  insertEntry(workId: string, snapshot: Revision['snapshot'], revision: Revision): void;
  updateDocument(workId: string, document: Document, revision: Revision): void;
  updateDirectory(workId: string, entry: Entry, revision: Revision): void;
  relocateEntry(workId: string, entry: Entry, parentId: string | null, position: number): void;
  listEntries(workId: string): Entry[];
  getDocument(workId: string, documentId: string): Document | undefined;
  /** candidates 覆盖正式正文，hidden 为会话中待删除、不参与检索的条目。 */
  searchDocuments(
    input: SearchDocumentsInput,
    candidates?: readonly EntrySnapshot[],
    hidden?: readonly string[]
  ): DocumentSearchPage;
  getRevision(workId: string, revisionId: string): Revision | undefined;
  /** 正文与前一修订不同的修订，最新在前。 */
  listRevisions(workId: string, entryId: string): RevisionSummary[];
  getRevisionEntryId(workId: string, revisionId: string): string | undefined;

  /** 条目及其正常子项记为同一删除批次，返回进入回收站的全部条目 ID。 */
  trashEntries(workId: string, rootIds: readonly string[], batchId: string, now: number): string[];
  listTrash(workId: string): TrashBatch[];
  isTrashed(workId: string, entryId: string): boolean;
  getTrashedDocument(workId: string, documentId: string): Document | undefined;
  /** 返回恢复到正常目录的条目 ID。 */
  restoreTrash(workId: string, batchId: string): string[];
  /** 返回被永久删除条目的元数据。 */
  purgeTrash(workId: string, batchId: string): Entry[];
  listTrashBatchIds(workId: string): string[];
  clearDrafts(workId: string, documentIds: readonly string[]): void;
  listTrashedWorks(): TrashedWork[];
  getTrashedWork(workId: string): TrashedWork | undefined;
  trashWork(workId: string, now: number): void;
  restoreWork(workId: string): void;
  /** 删除作品库中该作品的记录与会话归属，待审修改移出交付组。 */
  purgeWork(workId: string): void;
  /** 关闭作品数据库连接，返回仍存在的数据库文件。 */
  releaseWork(workId: string): string[];

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
  close(): void;
}
