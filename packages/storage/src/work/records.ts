import type Database from 'better-sqlite3';

import type { RecordRevision } from '@chaptale/creation';
import type { RecordPlacement, RecordSnapshot, StoryRecord, StoryRecordRef } from '@chaptale/creation/contracts';

export const recordSchema = `
  CREATE TABLE IF NOT EXISTS story_records (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    placement TEXT NOT NULL,
    placementKey TEXT NOT NULL,
    storyTime TEXT NOT NULL,
    position INTEGER NOT NULL,
    revisionId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS story_records_placement ON story_records(placementKey, position);
  CREATE TABLE IF NOT EXISTS story_record_resources (
    recordId TEXT NOT NULL REFERENCES story_records(id),
    resourceId TEXT NOT NULL REFERENCES entries(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (recordId, resourceId)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS story_record_resources_resource ON story_record_resources(resourceId);
  CREATE TABLE IF NOT EXISTS story_record_revisions (
    id TEXT PRIMARY KEY,
    recordId TEXT NOT NULL REFERENCES story_records(id),
    parentRevisionId TEXT,
    source TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS record_trash (
    recordId TEXT PRIMARY KEY REFERENCES story_records(id),
    batchId TEXT NOT NULL,
    deletedAt INTEGER NOT NULL
  ) STRICT;
`;

interface RecordRow {
  id: string;
  text: string;
  source: string;
  placement: string;
  placementKey: string;
  storyTime: string;
  position: number;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

const visible = 'id NOT IN (SELECT recordId FROM record_trash)';

function placementKey(placement: RecordPlacement): string {
  return placement.kind === 'chapter' ? `chapter:${placement.chapterId}` : placement.kind;
}

function toRecord(database: Database.Database, row: RecordRow): StoryRecord {
  const resources = database
    .prepare('SELECT resourceId FROM story_record_resources WHERE recordId = ? ORDER BY position')
    .all(row.id) as { resourceId: string }[];
  return {
    id: row.id,
    resourceIds: resources.map(resource => resource.resourceId),
    text: row.text,
    source: JSON.parse(row.source) as StoryRecord['source'],
    placement: JSON.parse(row.placement) as RecordPlacement,
    storyTime: row.storyTime,
    position: row.position,
    revisionId: row.revisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listRecords(database: Database.Database): StoryRecord[] {
  const rows = database
    .prepare(`SELECT * FROM story_records WHERE ${visible} ORDER BY placementKey, position`)
    .all() as RecordRow[];
  return rows.map(row => toRecord(database, row));
}

export function getRecord(database: Database.Database, recordId: string): StoryRecord | undefined {
  const row = database.prepare(`SELECT * FROM story_records WHERE id = ? AND ${visible}`).get(recordId) as
    | RecordRow
    | undefined;
  return row ? toRecord(database, row) : undefined;
}

export function isRecordTrashed(database: Database.Database, recordId: string): boolean {
  return database.prepare('SELECT 1 FROM record_trash WHERE recordId = ?').get(recordId) !== undefined;
}

function count(database: Database.Database, key: string, except: string): number {
  return (
    database
      .prepare(`SELECT count(*) AS count FROM story_records WHERE placementKey = ? AND id != ? AND ${visible}`)
      .get(key, except) as { count: number }
  ).count;
}

/** 同一位置中位于 position 之后的事件前移，补上离开的空位。 */
function close(database: Database.Database, key: string, position: number, except: string): void {
  database
    .prepare(
      `UPDATE story_records SET position = position - 1 WHERE placementKey = ? AND position > ? AND id != ? AND ${visible}`
    )
    .run(key, position, except);
}

/** 插入到 position，同一位置中原有的后续事件后移。 */
function open(database: Database.Database, key: string, position: number, except: string): void {
  database
    .prepare(
      `UPDATE story_records SET position = position + 1 WHERE placementKey = ? AND position >= ? AND id != ? AND ${visible}`
    )
    .run(key, position, except);
}

export function saveRecord(
  database: Database.Database,
  snapshot: RecordSnapshot,
  revision: RecordRevision
): StoryRecord {
  const key = placementKey(snapshot.placement);
  const previous = database.prepare('SELECT * FROM story_records WHERE id = ?').get(snapshot.id) as
    | RecordRow
    | undefined;
  let position = previous?.position ?? 0;
  if (!previous || previous.placementKey !== key) {
    if (previous) close(database, previous.placementKey, previous.position, previous.id);
    position = count(database, key, snapshot.id);
  }
  const row = {
    id: snapshot.id,
    text: snapshot.text,
    source: JSON.stringify(snapshot.source),
    placement: JSON.stringify(snapshot.placement),
    placementKey: key,
    storyTime: snapshot.storyTime,
    position,
    revisionId: revision.id,
    createdAt: previous?.createdAt ?? revision.createdAt,
    updatedAt: revision.createdAt
  };
  database
    .prepare(`
    INSERT INTO story_records (id, text, source, placement, placementKey, storyTime, position, revisionId, createdAt, updatedAt)
    VALUES (@id, @text, @source, @placement, @placementKey, @storyTime, @position, @revisionId, @createdAt, @updatedAt)
    ON CONFLICT (id) DO UPDATE SET text = excluded.text, source = excluded.source, placement = excluded.placement,
      placementKey = excluded.placementKey, storyTime = excluded.storyTime, position = excluded.position,
      revisionId = excluded.revisionId, updatedAt = excluded.updatedAt
  `)
    .run(row);
  database.prepare('DELETE FROM story_record_resources WHERE recordId = ?').run(snapshot.id);
  const link = database.prepare('INSERT INTO story_record_resources (recordId, resourceId, position) VALUES (?, ?, ?)');
  snapshot.resourceIds.forEach((resourceId, index) => link.run(snapshot.id, resourceId, index));
  database
    .prepare(`
    INSERT INTO story_record_revisions (id, recordId, parentRevisionId, source, snapshot, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .run(
      revision.id,
      revision.recordId,
      revision.parentRevisionId,
      revision.source,
      JSON.stringify(revision.snapshot),
      revision.createdAt
    );
  return getRecord(database, snapshot.id)!;
}

export function moveRecord(database: Database.Database, recordId: string, beforeId: string | null): StoryRecord {
  const record = database.prepare('SELECT * FROM story_records WHERE id = ?').get(recordId) as RecordRow;
  if (beforeId === recordId) return toRecord(database, record);
  close(database, record.placementKey, record.position, record.id);
  let position = count(database, record.placementKey, record.id);
  if (beforeId !== null) {
    const before = database.prepare('SELECT placementKey, position FROM story_records WHERE id = ?').get(beforeId) as {
      placementKey: string;
      position: number;
    };
    if (before.placementKey !== record.placementKey) throw new Error('只能在同一发生位置内调整顺序');
    position = before.position;
  }
  open(database, record.placementKey, position, record.id);
  database.prepare('UPDATE story_records SET position = ? WHERE id = ?').run(position, record.id);
  return getRecord(database, recordId)!;
}

export function trashRecord(database: Database.Database, recordId: string, batchId: string, now: number): void {
  const record = database.prepare('SELECT placementKey, position FROM story_records WHERE id = ?').get(recordId) as {
    placementKey: string;
    position: number;
  };
  database
    .prepare('INSERT INTO record_trash (recordId, batchId, deletedAt) VALUES (?, ?, ?)')
    .run(recordId, batchId, now);
  close(database, record.placementKey, record.position, recordId);
}

/** 回收站批次中的事件摘要。 */
export function trashedRecords(database: Database.Database, batchId: string): StoryRecordRef[] {
  const rows = database
    .prepare(
      'SELECT r.* FROM record_trash t JOIN story_records r ON r.id = t.recordId WHERE t.batchId = ? ORDER BY r.id'
    )
    .all(batchId) as RecordRow[];
  return rows.map(row => {
    const { id, text, resourceIds } = toRecord(database, row);
    return { id, text, resourceIds };
  });
}

/** 回到原序号，超出同位置数量时排到最后；返回恢复的事件 ID。 */
export function restoreRecords(database: Database.Database, batchId: string): string[] {
  const rows = database
    .prepare(
      'SELECT r.id, r.placementKey, r.position FROM record_trash t JOIN story_records r ON r.id = t.recordId WHERE t.batchId = ? ORDER BY r.position'
    )
    .all(batchId) as Pick<RecordRow, 'id' | 'placementKey' | 'position'>[];
  for (const row of rows) {
    database.prepare('DELETE FROM record_trash WHERE recordId = ?').run(row.id);
    const position = Math.min(row.position, count(database, row.placementKey, row.id));
    open(database, row.placementKey, position, row.id);
    database.prepare('UPDATE story_records SET position = ? WHERE id = ?').run(position, row.id);
  }
  return rows.map(row => row.id);
}

/** 永久删除事件及其修订与关联；正常事件先离开所在位置。 */
export function deleteRecords(database: Database.Database, recordIds: readonly string[]): void {
  for (const id of recordIds) {
    const row = database.prepare('SELECT placementKey, position FROM story_records WHERE id = ?').get(id) as
      | { placementKey: string; position: number }
      | undefined;
    if (!row) continue;
    if (!isRecordTrashed(database, id)) close(database, row.placementKey, row.position, id);
    database.prepare('DELETE FROM record_trash WHERE recordId = ?').run(id);
    database.prepare('DELETE FROM story_record_resources WHERE recordId = ?').run(id);
    database.prepare('DELETE FROM story_record_revisions WHERE recordId = ?').run(id);
    database.prepare('DELETE FROM story_records WHERE id = ?').run(id);
  }
}

/** 资料被永久删除时移除它与事件的关联；不再涉及任何资料的事件一并删除。 */
export function unlinkResources(database: Database.Database, resourceIds: readonly string[]): void {
  const unlink = database.prepare('DELETE FROM story_record_resources WHERE resourceId = ?');
  for (const id of resourceIds) unlink.run(id);
  const orphans = database
    .prepare('SELECT id FROM story_records WHERE id NOT IN (SELECT recordId FROM story_record_resources)')
    .all() as { id: string }[];
  deleteRecords(
    database,
    orphans.map(row => row.id)
  );
}

export function listRecordTrashBatchIds(database: Database.Database): string[] {
  return (database.prepare('SELECT DISTINCT batchId FROM record_trash').all() as { batchId: string }[]).map(
    row => row.batchId
  );
}

export function recordTrashBatches(database: Database.Database): { id: string; deletedAt: number }[] {
  return database
    .prepare('SELECT batchId AS id, max(deletedAt) AS deletedAt FROM record_trash GROUP BY batchId')
    .all() as { id: string; deletedAt: number }[];
}
