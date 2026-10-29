import type Database from 'better-sqlite3';

import type { WorkRepository } from '@chaptale/creation';
import type {
  Document,
  DocumentSearchPage,
  Entry,
  EntrySnapshot,
  Revision,
  RevisionSummary,
  SearchDocumentsInput,
  TrashBatch
} from '@chaptale/creation/contracts';

import { readCommandReceipt } from '../commands.ts';
import { entryFileDir } from './database.ts';
import * as entries from './entries.ts';
import { searchDocuments } from './search.ts';
import * as trash from './trash.ts';

/** 一部作品的 work.sqlite；连接由组装入口按需打开，每次读写时取用。 */
export class SqliteWorkRepository implements WorkRepository {
  readonly workId: string;
  private readonly rootDir: string;
  private readonly connect: () => Database.Database;

  constructor(rootDir: string, workId: string, connect: () => Database.Database) {
    this.rootDir = rootDir;
    this.workId = workId;
    this.connect = connect;
  }

  readReceipt<T>(commandId: string, parameters: readonly unknown[]): T | undefined {
    return readCommandReceipt<T>(this.connect(), commandId, parameters);
  }

  getEntry(entryId: string): Entry | undefined {
    return entries.getEntry(this.connect(), entryId);
  }
  listEntries(): Entry[] {
    return entries.listEntries(this.connect());
  }
  nextPosition(section: Entry['section'], parentId: string | null): number {
    return entries.nextPosition(this.connect(), section, parentId);
  }
  insertEntry(snapshot: Revision['snapshot'], revision: Revision): void {
    entries.insertEntry(this.connect(), snapshot, revision);
  }
  updateDocument(document: Document, revision: Revision): void {
    entries.updateDocument(this.connect(), document, revision);
  }
  updateTitle(snapshot: Revision['snapshot'], revision: Revision): void {
    entries.updateTitle(this.connect(), snapshot, revision);
  }
  relocateEntry(entry: Entry, parentId: string | null, position: number): void {
    entries.relocateEntry(this.connect(), entry, parentId, position);
  }
  getDocument(documentId: string): Document | undefined {
    return entries.getDocument(this.connect(), documentId);
  }
  entryFileDir(entryId: string): string {
    return entryFileDir(this.rootDir, this.workId, entryId);
  }
  searchDocuments(
    input: SearchDocumentsInput,
    candidates?: readonly EntrySnapshot[],
    hidden?: readonly string[]
  ): DocumentSearchPage {
    return searchDocuments(this.connect(), input, candidates, hidden);
  }
  getRevision(revisionId: string): Revision | undefined {
    return entries.getRevision(this.connect(), revisionId);
  }
  listRevisions(entryId: string): RevisionSummary[] {
    return entries.listRevisions(this.connect(), entryId);
  }
  getRevisionEntryId(revisionId: string): string | undefined {
    return entries.getRevisionEntryId(this.connect(), revisionId);
  }

  trashEntries(rootIds: readonly string[], batchId: string, now: number): string[] {
    return trash.trashEntries(this.connect(), rootIds, batchId, now);
  }
  listTrash(): TrashBatch[] {
    return trash.listTrash(this.connect());
  }
  isTrashed(entryId: string): boolean {
    return trash.isTrashed(this.connect(), entryId);
  }
  getTrashedDocument(documentId: string): Document | undefined {
    return trash.getTrashedDocument(this.connect(), documentId);
  }
  restoreTrash(batchId: string): string[] {
    return trash.restoreBatch(this.connect(), batchId);
  }
  purgeTrash(batchId: string): Entry[] {
    return trash.purgeBatch(this.connect(), batchId);
  }
  listTrashBatchIds(): string[] {
    return trash.listTrashBatchIds(this.connect());
  }
}
