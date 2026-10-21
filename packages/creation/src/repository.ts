import type { Document, DraftState, Entry, RecoveryDraft, Revision, Work } from './contracts.ts';

/** 业务所需的持久化操作；事务回调同步执行，修改与回执共用对应数据库事务。 */
export interface CreationRepository {
  libraryTransaction<T>(apply: () => T): T;
  libraryCommand<T>(commandId: string, parameters: readonly unknown[], apply: () => T): T;
  workCommand<T>(workId: string, commandId: string, parameters: readonly unknown[], apply: () => T): T;
  readWorkReceipt<T>(workId: string, commandId: string, parameters: readonly unknown[]): T | undefined;

  insertWork(work: Work): void;
  listWorks(): Work[];
  getEntry(workId: string, entryId: string): Entry | undefined;
  nextPosition(workId: string, section: Entry['section'], parentId: string | null): number;
  insertEntry(workId: string, snapshot: Revision['snapshot'], revision: Revision): void;
  updateDocument(workId: string, document: Document, revision: Revision): void;
  listEntries(workId: string): Entry[];
  getDocument(workId: string, documentId: string): Document | undefined;
  getRevision(workId: string, revisionId: string): Revision | undefined;
  getRevisionEntryId(workId: string, revisionId: string): string | undefined;

  getDraftState(workId: string, documentId: string): DraftState;
  putDraft(draft: RecoveryDraft): void;
  clearDraft(workId: string, documentId: string, draftId: string): void;
  close(): void;
}
