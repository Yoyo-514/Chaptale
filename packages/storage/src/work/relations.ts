import type Database from 'better-sqlite3';

import type { RelationRevision } from '@chaptale/creation';
import type {
  RelationMilestone,
  RelationSnapshot,
  StoryRelation,
  StoryRelationRef
} from '@chaptale/creation/contracts';

export const relationSchema = `
  CREATE TABLE IF NOT EXISTS story_relations (
    id TEXT PRIMARY KEY,
    firstId TEXT NOT NULL REFERENCES entries(id),
    secondId TEXT NOT NULL REFERENCES entries(id),
    type TEXT NOT NULL,
    directed INTEGER NOT NULL,
    firstTitle TEXT NOT NULL,
    secondTitle TEXT NOT NULL,
    revisionId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS story_relations_first ON story_relations(firstId);
  CREATE INDEX IF NOT EXISTS story_relations_second ON story_relations(secondId);
  CREATE TABLE IF NOT EXISTS story_relation_milestones (
    id TEXT PRIMARY KEY,
    relationId TEXT NOT NULL REFERENCES story_relations(id),
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    placement TEXT NOT NULL,
    storyTime TEXT NOT NULL,
    position INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS story_relation_milestones_relation ON story_relation_milestones(relationId, position);
  CREATE TABLE IF NOT EXISTS story_relation_revisions (
    id TEXT PRIMARY KEY,
    relationId TEXT NOT NULL REFERENCES story_relations(id),
    parentRevisionId TEXT,
    source TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS relation_trash (
    relationId TEXT PRIMARY KEY REFERENCES story_relations(id),
    batchId TEXT NOT NULL,
    deletedAt INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS milestone_trash (
    milestoneId TEXT PRIMARY KEY REFERENCES story_relation_milestones(id),
    batchId TEXT NOT NULL,
    deletedAt INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS milestone_trash_batch ON milestone_trash(batchId);
`;

interface RelationRow {
  id: string;
  firstId: string;
  secondId: string;
  type: string;
  directed: number;
  firstTitle: string;
  secondTitle: string;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}
interface MilestoneRow {
  id: string;
  kind: RelationMilestone['kind'];
  source: string;
  placement: string;
  storyTime: string;
}

const visible = 'id NOT IN (SELECT relationId FROM relation_trash)';
/** 随出处章节进入回收站的建立／结束不出现在关系上，保存关系时保留原行。 */
const visibleMilestone = 'id NOT IN (SELECT milestoneId FROM milestone_trash)';

function toRelation(database: Database.Database, row: RelationRow): StoryRelation {
  const milestones = database
    .prepare(`SELECT * FROM story_relation_milestones WHERE relationId = ? AND ${visibleMilestone} ORDER BY position`)
    .all(row.id) as MilestoneRow[];
  return {
    id: row.id,
    resourceIds: [row.firstId, row.secondId],
    type: row.type,
    directed: row.directed === 1,
    titles: [row.firstTitle, row.secondTitle],
    milestones: milestones.map(milestone => ({
      id: milestone.id,
      kind: milestone.kind,
      source: JSON.parse(milestone.source) as RelationMilestone['source'],
      placement: JSON.parse(milestone.placement) as RelationMilestone['placement'],
      storyTime: milestone.storyTime
    })),
    revisionId: row.revisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listRelations(database: Database.Database): StoryRelation[] {
  const rows = database
    .prepare(`SELECT * FROM story_relations WHERE ${visible} ORDER BY createdAt, id`)
    .all() as RelationRow[];
  return rows.map(row => toRelation(database, row));
}

export function getRelation(database: Database.Database, relationId: string): StoryRelation | undefined {
  const row = database.prepare(`SELECT * FROM story_relations WHERE id = ? AND ${visible}`).get(relationId) as
    | RelationRow
    | undefined;
  return row ? toRelation(database, row) : undefined;
}

export function isRelationTrashed(database: Database.Database, relationId: string): boolean {
  return database.prepare('SELECT 1 FROM relation_trash WHERE relationId = ?').get(relationId) !== undefined;
}

export function saveRelation(
  database: Database.Database,
  snapshot: RelationSnapshot,
  revision: RelationRevision
): StoryRelation {
  database
    .prepare(`
    INSERT INTO story_relations (id, firstId, secondId, type, directed, firstTitle, secondTitle, revisionId, createdAt, updatedAt)
    VALUES (@id, @firstId, @secondId, @type, @directed, @firstTitle, @secondTitle, @revisionId, @createdAt, @createdAt)
    ON CONFLICT (id) DO UPDATE SET firstId = excluded.firstId, secondId = excluded.secondId, type = excluded.type,
      directed = excluded.directed, firstTitle = excluded.firstTitle, secondTitle = excluded.secondTitle,
      revisionId = excluded.revisionId, updatedAt = excluded.updatedAt
  `)
    .run({
      id: snapshot.id,
      firstId: snapshot.resourceIds[0],
      secondId: snapshot.resourceIds[1],
      type: snapshot.type,
      directed: snapshot.directed ? 1 : 0,
      firstTitle: snapshot.titles[0],
      secondTitle: snapshot.titles[1],
      revisionId: revision.id,
      createdAt: revision.createdAt
    });
  database
    .prepare(`DELETE FROM story_relation_milestones WHERE relationId = ? AND ${visibleMilestone}`)
    .run(snapshot.id);
  const insert = database.prepare(`
    INSERT INTO story_relation_milestones (id, relationId, kind, source, placement, storyTime, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  snapshot.milestones.forEach((milestone, index) =>
    insert.run(
      milestone.id,
      snapshot.id,
      milestone.kind,
      JSON.stringify(milestone.source),
      JSON.stringify(milestone.placement),
      milestone.storyTime,
      index
    )
  );
  database
    .prepare(`
    INSERT INTO story_relation_revisions (id, relationId, parentRevisionId, source, snapshot, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .run(
      revision.id,
      revision.relationId,
      revision.parentRevisionId,
      revision.source,
      JSON.stringify(revision.snapshot),
      revision.createdAt
    );
  return getRelation(database, snapshot.id)!;
}

export function trashRelation(database: Database.Database, relationId: string, batchId: string, now: number): void {
  database
    .prepare('INSERT INTO relation_trash (relationId, batchId, deletedAt) VALUES (?, ?, ?)')
    .run(relationId, batchId, now);
}

/** 建立／结束随出处章节移入回收站。 */
export function trashMilestones(
  database: Database.Database,
  milestoneIds: readonly string[],
  batchId: string,
  now: number
): void {
  const insert = database.prepare('INSERT INTO milestone_trash (milestoneId, batchId, deletedAt) VALUES (?, ?, ?)');
  for (const id of milestoneIds) insert.run(id, batchId, now);
}

/** 关系有建立在回收站中；保存时计入“至少一条建立”。 */
export function hasTrashedStart(database: Database.Database, relationId: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 FROM milestone_trash t JOIN story_relation_milestones m ON m.id = t.milestoneId WHERE m.relationId = ? AND m.kind = 'start'"
      )
      .get(relationId) !== undefined
  );
}

/** 批次中随章节移走、所属关系仍在的建立／结束数量。 */
export function trashedMilestoneCount(database: Database.Database, batchId: string): number {
  return (
    database
      .prepare(
        `SELECT count(*) AS count FROM milestone_trash t JOIN story_relation_milestones m ON m.id = t.milestoneId
         WHERE t.batchId = ? AND m.relationId NOT IN (SELECT relationId FROM relation_trash WHERE batchId = t.batchId)`
      )
      .get(batchId) as { count: number }
  ).count;
}

/** 回收站批次中的关系摘要。 */
export function trashedRelations(database: Database.Database, batchId: string): StoryRelationRef[] {
  return (
    database
      .prepare(
        'SELECT r.id, r.type, r.firstId, r.secondId FROM relation_trash t JOIN story_relations r ON r.id = t.relationId WHERE t.batchId = ? ORDER BY r.id'
      )
      .all(batchId) as { id: string; type: string; firstId: string; secondId: string }[]
  ).map(row => ({ id: row.id, type: row.type, resourceIds: [row.firstId, row.secondId] }));
}

export function restoreRelations(database: Database.Database, batchId: string): void {
  database.prepare('DELETE FROM relation_trash WHERE batchId = ?').run(batchId);
  database.prepare('DELETE FROM milestone_trash WHERE batchId = ?').run(batchId);
}

/** 永久删除关系及其建立／结束、修订与回收站记录。 */
function deleteRelations(database: Database.Database, relationIds: readonly string[]): void {
  for (const id of relationIds) {
    database.prepare('DELETE FROM relation_trash WHERE relationId = ?').run(id);
    database
      .prepare(
        'DELETE FROM milestone_trash WHERE milestoneId IN (SELECT id FROM story_relation_milestones WHERE relationId = ?)'
      )
      .run(id);
    database.prepare('DELETE FROM story_relation_milestones WHERE relationId = ?').run(id);
    database.prepare('DELETE FROM story_relation_revisions WHERE relationId = ?').run(id);
    database.prepare('DELETE FROM story_relations WHERE id = ?').run(id);
  }
}

export function purgeRelations(database: Database.Database, batchId: string): void {
  database.prepare('CREATE TEMP TABLE IF NOT EXISTS purge_milestones (id TEXT PRIMARY KEY)').run();
  database.prepare('DELETE FROM temp.purge_milestones').run();
  database
    .prepare('INSERT INTO temp.purge_milestones SELECT milestoneId FROM milestone_trash WHERE batchId = ?')
    .run(batchId);
  database.prepare('DELETE FROM milestone_trash WHERE batchId = ?').run(batchId);
  database.prepare('DELETE FROM story_relation_milestones WHERE id IN (SELECT id FROM temp.purge_milestones)').run();
  database.prepare('DELETE FROM temp.purge_milestones').run();
  deleteRelations(
    database,
    (
      database.prepare('SELECT relationId FROM relation_trash WHERE batchId = ?').all(batchId) as {
        relationId: string;
      }[]
    ).map(row => row.relationId)
  );
}

/** 资料被永久删除时，涉及它的关系（含回收站中的）一并删除。 */
export function deleteResourceRelations(database: Database.Database, resourceIds: readonly string[]): void {
  const find = database.prepare('SELECT id FROM story_relations WHERE firstId = ? OR secondId = ?');
  deleteRelations(
    database,
    resourceIds.flatMap(id => (find.all(id, id) as { id: string }[]).map(row => row.id))
  );
}

export function listRelationTrashBatchIds(database: Database.Database): string[] {
  return (database.prepare('SELECT DISTINCT batchId FROM relation_trash').all() as { batchId: string }[]).map(
    row => row.batchId
  );
}

export function relationTrashBatches(database: Database.Database): { id: string; deletedAt: number }[] {
  return database
    .prepare('SELECT batchId AS id, max(deletedAt) AS deletedAt FROM relation_trash GROUP BY batchId')
    .all() as { id: string; deletedAt: number }[];
}
