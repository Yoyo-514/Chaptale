import type Database from 'better-sqlite3';

import type { Document, Entry, Revision } from '@chaptale/creation/contracts';

import { indexDocument } from './search.ts';

const metadataColumns =
  'id, parentId, section, kind, title, position, format, wordCount, revisionId, createdAt, updatedAt';

export function getEntry(database: Database.Database, id: string): Entry | undefined {
  return database.prepare(`SELECT ${metadataColumns} FROM entries WHERE id = ?`).get(id) as Entry | undefined;
}
export function listEntries(database: Database.Database): Entry[] {
  return database
    .prepare(`SELECT ${metadataColumns} FROM entries ORDER BY section, parentId, position, id`)
    .all() as Entry[];
}
export function nextPosition(database: Database.Database, section: Entry['section'], parentId: string | null): number {
  const row = database
    .prepare('SELECT coalesce(max(position) + 1, 0) AS position FROM entries WHERE section = ? AND parentId IS ?')
    .get(section, parentId) as { position: number };
  return row.position;
}
export function getDocument(database: Database.Database, id: string): Document | undefined {
  return database.prepare("SELECT * FROM entries WHERE id = ? AND kind = 'document'").get(id) as Document | undefined;
}

export function insertEntry(database: Database.Database, snapshot: Revision['snapshot'], revision: Revision): void {
  database
    .prepare(`
    INSERT INTO entries (id, parentId, section, kind, title, position, format, content, wordCount, revisionId, createdAt, updatedAt)
    VALUES (@id, @parentId, @section, @kind, @title, @position, @format, @content, @wordCount, @revisionId, @createdAt, @updatedAt)
  `)
    .run(snapshot);
  insertRevision(database, revision);
  indexDocument(database, snapshot);
}
export function updateDocument(database: Database.Database, document: Document, revision: Revision): void {
  database
    .prepare(`
    UPDATE entries SET title = @title, format = @format, content = @content, wordCount = @wordCount,
      revisionId = @revisionId, updatedAt = @updatedAt WHERE id = @id
  `)
    .run(document);
  insertRevision(database, revision);
  indexDocument(database, document);
}
export function updateDirectory(database: Database.Database, entry: Entry, revision: Revision): void {
  database
    .prepare('UPDATE entries SET title = @title, revisionId = @revisionId, updatedAt = @updatedAt WHERE id = @id')
    .run(entry);
  insertRevision(database, revision);
}
export function relocateEntry(
  database: Database.Database,
  entry: Entry,
  parentId: string | null,
  position: number
): void {
  database
    .prepare('UPDATE entries SET position = position - 1 WHERE section = ? AND parentId IS ? AND position > ?')
    .run(entry.section, entry.parentId, entry.position);
  database
    .prepare(
      'UPDATE entries SET position = position + 1 WHERE section = ? AND parentId IS ? AND position >= ? AND id != ?'
    )
    .run(entry.section, parentId, position, entry.id);
  database.prepare('UPDATE entries SET parentId = ?, position = ? WHERE id = ?').run(parentId, position, entry.id);
}
export function getRevision(database: Database.Database, id: string): Revision | undefined {
  const row = database
    .prepare('SELECT id, entryId, parentRevisionId, source, snapshot, createdAt FROM revisions WHERE id = ?')
    .get(id) as (Omit<Revision, 'snapshot'> & { snapshot: string }) | undefined;
  if (!row) return undefined;
  return { ...row, snapshot: JSON.parse(row.snapshot) as Revision['snapshot'] };
}
export function getRevisionEntryId(database: Database.Database, id: string): string | undefined {
  const row = database.prepare('SELECT entryId FROM revisions WHERE id = ?').get(id) as { entryId: string } | undefined;
  return row?.entryId;
}
function insertRevision(database: Database.Database, revision: Revision): void {
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
