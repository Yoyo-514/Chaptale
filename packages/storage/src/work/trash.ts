import type Database from 'better-sqlite3';

import type { Document, Entry, TrashBatch } from '@chaptale/creation/contracts';

import { entryColumns, readSnapshot } from './entries.ts';
import * as records from './records.ts';
import * as relations from './relations.ts';
import { indexDocument } from './search.ts';

/** 原父目录被永久清空的条目改挂根层级，恢复时排到末尾。 */
const rootTail = 2_147_483_647;

export const trashSchema = `
  CREATE TABLE IF NOT EXISTS trash (
    entryId TEXT PRIMARY KEY REFERENCES entries(id),
    batchId TEXT NOT NULL,
    deletedAt INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS trash_batch ON trash(batchId);
`;

export function isTrashed(database: Database.Database, entryId: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM trash WHERE entryId = ?').get(entryId));
}

/** 将条目及其仍在正常目录中的子项记为同一批次，同级后续条目前移。 */
export function trashEntries(database: Database.Database, rootIds: readonly string[], batchId: string, now: number) {
  const trashed: string[] = [];
  for (const rootId of rootIds) {
    const root = database
      .prepare(`SELECT ${entryColumns()} FROM entries WHERE id = ? AND id NOT IN (SELECT entryId FROM trash)`)
      .get(rootId) as Entry | undefined;
    if (!root) continue;
    const ids = (
      database
        .prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT ?
        UNION ALL
        SELECT e.id FROM entries e JOIN subtree s ON e.parentId = s.id WHERE e.id NOT IN (SELECT entryId FROM trash)
      ) SELECT id FROM subtree
    `)
        .all(rootId) as { id: string }[]
    ).map(row => row.id);
    const insert = database.prepare('INSERT INTO trash (entryId, batchId, deletedAt) VALUES (?, ?, ?)');
    const unindex = database.prepare('DELETE FROM document_search WHERE entryId = ?');
    for (const id of ids) {
      insert.run(id, batchId, now);
      unindex.run(id);
    }
    database
      .prepare(
        `UPDATE entries SET position = position - 1 WHERE section = ? AND parentId IS ? AND position > ? AND id NOT IN (SELECT entryId FROM trash)`
      )
      .run(root.section, root.parentId, root.position);
    trashed.push(...ids);
  }
  return trashed;
}

export function listTrash(database: Database.Database): TrashBatch[] {
  const batches = database
    .prepare('SELECT batchId AS id, max(deletedAt) AS deletedAt, count(*) AS entryCount FROM trash GROUP BY batchId')
    .all() as Omit<TrashBatch, 'roots' | 'records' | 'relations' | 'milestoneCount'>[];
  for (const batch of [...records.recordTrashBatches(database), ...relations.relationTrashBatches(database)])
    if (!batches.some(item => item.id === batch.id)) batches.push({ ...batch, entryCount: 0 });
  return batches
    .map(batch => ({
      ...batch,
      roots: batchRoots(database, batch.id),
      records: records.trashedRecords(database, batch.id),
      relations: relations.trashedRelations(database, batch.id),
      milestoneCount: relations.trashedMilestoneCount(database, batch.id)
    }))
    .sort((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
}

export function getTrashedDocument(database: Database.Database, entryId: string): Document | undefined {
  if (!isTrashed(database, entryId)) return undefined;
  const snapshot = readSnapshot(database, entryId);
  return snapshot?.kind === 'document' ? (snapshot as Document) : undefined;
}

/** 整批恢复；原父目录仍在回收站时只恢复上方各级目录本身。返回恢复后的正常条目。 */
export function restoreBatch(database: Database.Database, batchId: string): string[] {
  const restored: string[] = [];
  for (const root of batchRoots(database, batchId)) {
    restoreAncestors(database, root.parentId, restored);
    placeEntry(database, root, restored);
  }
  const rest = database.prepare('SELECT entryId FROM trash WHERE batchId = ?').all(batchId) as { entryId: string }[];
  for (const { entryId } of rest) restored.push(entryId);
  database.prepare('DELETE FROM trash WHERE batchId = ?').run(batchId);
  for (const { entryId } of rest) reindex(database, entryId);
  records.restoreRecords(database, batchId);
  relations.restoreRelations(database, batchId);
  return restored;
}

/**
 * 永久删除批次内条目、事件、关系及修订；其他批次中挂在这些目录下的条目改挂根层级。
 * 被删资料与事件的关联一并移除，不再涉及任何资料的事件和涉及被删资料的关系随之删除。返回被删除条目的元数据。
 */
export function purgeBatch(database: Database.Database, batchId: string): Entry[] {
  const purged = database
    .prepare(`
    SELECT ${entryColumns('e')}
    FROM trash t JOIN entries e ON e.id = t.entryId WHERE t.batchId = ?
  `)
    .all(batchId) as Entry[];
  database
    .prepare(`
    UPDATE entries SET parentId = NULL, position = ?
    WHERE parentId IN (SELECT entryId FROM trash WHERE batchId = ?)
      AND id NOT IN (SELECT entryId FROM trash WHERE batchId = ?)
  `)
    .run(rootTail, batchId, batchId);
  records.deleteRecords(
    database,
    (
      database.prepare('SELECT recordId FROM record_trash WHERE batchId = ?').all(batchId) as { recordId: string }[]
    ).map(row => row.recordId)
  );
  records.unlinkResources(
    database,
    purged.map(entry => entry.id)
  );
  relations.purgeRelations(database, batchId);
  relations.deleteResourceRelations(
    database,
    purged.map(entry => entry.id)
  );
  database.prepare('DELETE FROM revisions WHERE entryId IN (SELECT entryId FROM trash WHERE batchId = ?)').run(batchId);
  database.prepare('CREATE TEMP TABLE IF NOT EXISTS purge_ids (id TEXT PRIMARY KEY)').run();
  database.prepare('DELETE FROM temp.purge_ids').run();
  database.prepare('INSERT INTO temp.purge_ids SELECT entryId FROM trash WHERE batchId = ?').run(batchId);
  database.prepare('DELETE FROM trash WHERE batchId = ?').run(batchId);
  database.prepare('DELETE FROM resource_attributes WHERE entryId IN (SELECT id FROM temp.purge_ids)').run();
  database.prepare('DELETE FROM entries WHERE id IN (SELECT id FROM temp.purge_ids)').run();
  database.prepare('DELETE FROM temp.purge_ids').run();
  return purged;
}

export function listTrashBatchIds(database: Database.Database): string[] {
  const ids = (database.prepare('SELECT DISTINCT batchId FROM trash').all() as { batchId: string }[]).map(
    row => row.batchId
  );
  return [
    ...new Set([...ids, ...records.listRecordTrashBatchIds(database), ...relations.listRelationTrashBatchIds(database)])
  ];
}

function batchRoots(database: Database.Database, batchId: string): Entry[] {
  return database
    .prepare(`
    SELECT ${entryColumns('e')}
    FROM trash t JOIN entries e ON e.id = t.entryId
    WHERE t.batchId = ? AND NOT EXISTS (
      SELECT 1 FROM trash parent WHERE parent.entryId = e.parentId AND parent.batchId = t.batchId
    )
    ORDER BY e.section, e.position, e.id
  `)
    .all(batchId) as Entry[];
}

function restoreAncestors(database: Database.Database, parentId: string | null, restored: string[]): void {
  if (parentId === null || !isTrashed(database, parentId)) return;
  const parent = database.prepare(`SELECT ${entryColumns()} FROM entries WHERE id = ?`).get(parentId) as Entry;
  restoreAncestors(database, parent.parentId, restored);
  placeEntry(database, parent, restored);
}

/** 回到原序号，超出同级数量时排到最后。 */
function placeEntry(database: Database.Database, entry: Entry, restored: string[]): void {
  database.prepare('DELETE FROM trash WHERE entryId = ?').run(entry.id);
  const { count } = database
    .prepare(
      `SELECT count(*) AS count FROM entries WHERE section = ? AND parentId IS ? AND id != ? AND id NOT IN (SELECT entryId FROM trash)`
    )
    .get(entry.section, entry.parentId, entry.id) as { count: number };
  const position = Math.min(entry.position, count);
  database
    .prepare(
      `UPDATE entries SET position = position + 1 WHERE section = ? AND parentId IS ? AND position >= ? AND id != ? AND id NOT IN (SELECT entryId FROM trash)`
    )
    .run(entry.section, entry.parentId, position, entry.id);
  database.prepare('UPDATE entries SET position = ? WHERE id = ?').run(position, entry.id);
  reindex(database, entry.id);
  restored.push(entry.id);
}

function reindex(database: Database.Database, entryId: string): void {
  const snapshot = readSnapshot(database, entryId);
  if (snapshot) indexDocument(database, snapshot);
}
