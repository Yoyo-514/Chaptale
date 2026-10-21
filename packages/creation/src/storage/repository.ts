import type Database from 'better-sqlite3';

import type { Document, DraftState, Entry, RecoveryDraft, Revision, Work } from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import { commitCommand, readCommandReceipt } from './commands.ts';
import { openLibrary, openWorkDatabase } from './database.ts';

export async function openCreationStorage(options: { rootDir: string }): Promise<CreationRepository> {
  return new SqliteCreationRepository(options.rootDir, await openLibrary(options.rootDir));
}

class SqliteCreationRepository implements CreationRepository {
  private readonly rootDir: string;
  private readonly library: Database.Database;
  private work?: { id: string; database: Database.Database };

  constructor(rootDir: string, library: Database.Database) {
    this.rootDir = rootDir;
    this.library = library;
  }

  libraryTransaction<T>(apply: () => T): T {
    return this.library.transaction(apply)();
  }

  libraryCommand<T>(commandId: string, parameters: readonly unknown[], apply: () => T): T {
    return commitCommand(this.library, commandId, parameters, apply);
  }

  workCommand<T>(workId: string, commandId: string, parameters: readonly unknown[], apply: () => T): T {
    return commitCommand(this.useWork(workId), commandId, parameters, apply);
  }

  readWorkReceipt<T>(workId: string, commandId: string, parameters: readonly unknown[]): T | undefined {
    return readCommandReceipt<T>(this.useWork(workId), commandId, parameters);
  }

  insertWork(work: Work): void {
    this.library
      .prepare(
        'INSERT INTO works (id, title, kind, createdAt, updatedAt) VALUES (@id, @title, @kind, @createdAt, @updatedAt)'
      )
      .run(work);
  }

  listWorks(): Work[] {
    return this.library
      .prepare('SELECT id, title, kind, createdAt, updatedAt FROM works ORDER BY updatedAt DESC, id')
      .all() as Work[];
  }

  getEntry(workId: string, entryId: string): Entry | undefined {
    return this.useWork(workId)
      .prepare(`
      SELECT id, parentId, section, kind, title, position, format, wordCount, revisionId, createdAt, updatedAt
      FROM entries WHERE id = ?
    `)
      .get(entryId) as Entry | undefined;
  }

  nextPosition(workId: string, section: Entry['section'], parentId: string | null): number {
    const row = this.useWork(workId)
      .prepare('SELECT coalesce(max(position) + 1, 0) AS position FROM entries WHERE section = ? AND parentId IS ?')
      .get(section, parentId) as { position: number };
    return row.position;
  }

  insertEntry(workId: string, snapshot: Revision['snapshot'], revision: Revision): void {
    const database = this.useWork(workId);
    database
      .prepare(`
      INSERT INTO entries (id, parentId, section, kind, title, position, format, content, wordCount, revisionId, createdAt, updatedAt)
      VALUES (@id, @parentId, @section, @kind, @title, @position, @format, @content, @wordCount, @revisionId, @createdAt, @updatedAt)
    `)
      .run(snapshot);
    this.insertRevision(database, revision);
  }

  updateDocument(workId: string, document: Document, revision: Revision): void {
    const database = this.useWork(workId);
    database
      .prepare(`
      UPDATE entries SET title = @title, format = @format, content = @content, wordCount = @wordCount,
        revisionId = @revisionId, updatedAt = @updatedAt WHERE id = @id
    `)
      .run(document);
    this.insertRevision(database, revision);
  }

  listEntries(workId: string): Entry[] {
    return this.useWork(workId)
      .prepare(`
      SELECT id, parentId, section, kind, title, position, format, wordCount, revisionId, createdAt, updatedAt
      FROM entries ORDER BY section, parentId, position, id
    `)
      .all() as Entry[];
  }

  getDocument(workId: string, documentId: string): Document | undefined {
    return this.useWork(workId).prepare("SELECT * FROM entries WHERE id = ? AND kind = 'document'").get(documentId) as
      | Document
      | undefined;
  }

  getRevision(workId: string, revisionId: string): Revision | undefined {
    const row = this.useWork(workId)
      .prepare('SELECT id, entryId, parentRevisionId, source, snapshot, createdAt FROM revisions WHERE id = ?')
      .get(revisionId) as (Omit<Revision, 'snapshot'> & { snapshot: string }) | undefined;
    if (!row) return undefined;
    return { ...row, snapshot: JSON.parse(row.snapshot) as Revision['snapshot'] };
  }

  getRevisionEntryId(workId: string, revisionId: string): string | undefined {
    const row = this.useWork(workId).prepare('SELECT entryId FROM revisions WHERE id = ?').get(revisionId) as
      | { entryId: string }
      | undefined;
    return row?.entryId;
  }

  getDraftState(workId: string, documentId: string): DraftState {
    const row = this.library
      .prepare('SELECT version, draft FROM recovery_drafts WHERE workId = ? AND documentId = ?')
      .get(workId, documentId) as { version: string; draft: string | null } | undefined;
    if (!row) return { version: null, draft: null };
    return { version: row.version, draft: row.draft === null ? null : (JSON.parse(row.draft) as RecoveryDraft) };
  }

  putDraft(draft: RecoveryDraft): void {
    this.library
      .prepare(`
      INSERT INTO recovery_drafts (workId, documentId, version, draft) VALUES (?, ?, ?, ?)
      ON CONFLICT (workId, documentId) DO UPDATE SET version = excluded.version, draft = excluded.draft
    `)
      .run(draft.workId, draft.documentId, draft.id, JSON.stringify(draft));
  }

  clearDraft(workId: string, documentId: string, draftId: string): void {
    // 保留版本身份以拒绝迟到写入；条件更新保护较新的草稿。
    this.library
      .prepare('UPDATE recovery_drafts SET draft = NULL WHERE workId = ? AND documentId = ? AND version = ?')
      .run(workId, documentId, draftId);
  }

  close(): void {
    this.work?.database.close();
    this.library.close();
  }

  private insertRevision(database: Database.Database, revision: Revision): void {
    database
      .prepare(
        'INSERT INTO revisions (id, entryId, parentRevisionId, source, snapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        revision.id,
        revision.entryId,
        revision.parentRevisionId,
        revision.source,
        JSON.stringify(revision.snapshot),
        revision.createdAt
      );
  }

  private useWork(workId: string): Database.Database {
    if (this.work?.id === workId) return this.work.database;
    if (!this.library.prepare('SELECT id FROM works WHERE id = ?').get(workId)) throw new Error('作品不存在');
    const database = openWorkDatabase(this.rootDir, workId);
    this.work?.database.close();
    this.work = { id: workId, database };
    return database;
  }
}
