import type {
  CreationChanges,
  CreationCursor,
  CreationEvent,
  CreationSnapshot,
  Document,
  DraftState,
  Entry,
  RecoveryDraft,
  SessionAssignment,
  SessionSelection,
  SessionState,
  Revision,
  Work,
  WorkbenchState
} from './contracts.ts';

/** 回执中的事件描述复用结果元数据，避免重复保存条目。 */
export type CommitEffect =
  | { kind: 'work' }
  | { kind: 'entry' }
  | { kind: 'move'; from: { parentId: string | null; position: number } };

export interface CommandCommit<T> {
  result: T;
  event: CreationEvent;
  fresh: boolean;
}

/** 业务所需的持久化操作；事务回调同步执行，修改与回执共用对应数据库事务。 */
export interface CreationRepository {
  libraryTransaction<T>(apply: () => T): T;
  command<T extends Work | Entry>(
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
  getRevision(workId: string, revisionId: string): Revision | undefined;
  getRevisionEntryId(workId: string, revisionId: string): string | undefined;

  getDraftState(workId: string, documentId: string): DraftState;
  putDraft(draft: RecoveryDraft): void;
  clearDraft(workId: string, documentId: string, draftId: string): void;
  close(): void;
}
