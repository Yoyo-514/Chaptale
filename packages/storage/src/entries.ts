import type Database from 'better-sqlite3';

import type { Document, Entry, ResourceAttributes, Revision, RevisionSummary } from '@chaptale/creation/contracts';

import { indexDocument } from './search.ts';

const metadataColumns =
  'id, parentId, section, kind, title, position, format, wordCount, revisionId, createdAt, updatedAt';

export function getEntry(database: Database.Database, id: string): Entry | undefined {
  return database
    .prepare(`SELECT ${metadataColumns} FROM entries WHERE id = ? AND id NOT IN (SELECT entryId FROM trash)`)
    .get(id) as Entry | undefined;
}
export function listEntries(database: Database.Database): Entry[] {
  return database
    .prepare(
      `SELECT ${metadataColumns} FROM entries WHERE id NOT IN (SELECT entryId FROM trash) ORDER BY section, parentId, position, id`
    )
    .all() as Entry[];
}
export function nextPosition(database: Database.Database, section: Entry['section'], parentId: string | null): number {
  const row = database
    .prepare(
      'SELECT coalesce(max(position) + 1, 0) AS position FROM entries WHERE section = ? AND parentId IS ? AND id NOT IN (SELECT entryId FROM trash)'
    )
    .get(section, parentId) as { position: number };
  return row.position;
}
interface AttributeRow {
  type: string | null;
  aliases: string | null;
  tags: string | null;
}

export function getDocument(database: Database.Database, id: string): Document | undefined {
  const row = database
    .prepare(`
    SELECT e.*, a.type, a.aliases, a.tags FROM entries e LEFT JOIN resource_attributes a ON a.entryId = e.id
    WHERE e.id = ? AND e.kind = 'document' AND e.id NOT IN (SELECT entryId FROM trash)
  `)
    .get(id) as (Omit<Document, 'attributes'> & AttributeRow) | undefined;
  if (!row) return undefined;
  const { type, aliases, tags, ...document } = row;
  const attributes: ResourceAttributes | null =
    type === null ? null : { type, aliases: JSON.parse(aliases!), tags: JSON.parse(tags!) };
  return { ...document, attributes };
}

function writeAttributes(database: Database.Database, entryId: string, attributes: ResourceAttributes | null): void {
  if (!attributes) return;
  database
    .prepare('INSERT OR REPLACE INTO resource_attributes (entryId, type, aliases, tags) VALUES (?, ?, ?, ?)')
    .run(entryId, attributes.type, JSON.stringify(attributes.aliases), JSON.stringify(attributes.tags));
}

export function insertEntry(database: Database.Database, snapshot: Revision['snapshot'], revision: Revision): void {
  database
    .prepare(`
    INSERT INTO entries (id, parentId, section, kind, title, position, format, content, wordCount, revisionId, createdAt, updatedAt)
    VALUES (@id, @parentId, @section, @kind, @title, @position, @format, @content, @wordCount, @revisionId, @createdAt, @updatedAt)
  `)
    .run(snapshot);
  writeAttributes(database, snapshot.id, snapshot.attributes);
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
  writeAttributes(database, document.id, document.attributes);
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
    .prepare(
      'UPDATE entries SET position = position - 1 WHERE section = ? AND parentId IS ? AND position > ? AND id NOT IN (SELECT entryId FROM trash)'
    )
    .run(entry.section, entry.parentId, entry.position);
  database
    .prepare(
      'UPDATE entries SET position = position + 1 WHERE section = ? AND parentId IS ? AND position >= ? AND id != ? AND id NOT IN (SELECT entryId FROM trash)'
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
export function listRevisions(database: Database.Database, entryId: string): RevisionSummary[] {
  return database
    .prepare(
      `SELECT id, source, wordCount, createdAt FROM (
        SELECT id, source, createdAt, rowid AS seq,
          snapshot ->> '$.wordCount' AS wordCount,
          snapshot ->> '$.content' AS content,
          LAG(snapshot ->> '$.content') OVER (ORDER BY createdAt, rowid) AS previous
        FROM revisions WHERE entryId = ?
      ) WHERE previous IS NULL OR content IS NOT previous ORDER BY createdAt DESC, seq DESC`
    )
    .all(entryId) as RevisionSummary[];
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
