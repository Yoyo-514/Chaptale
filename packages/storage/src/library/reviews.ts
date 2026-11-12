import type Database from 'better-sqlite3';

import type { ReviewBatchIntent, ReviewIntent, PendingChange } from '@chaptale/creation/contracts';

export function readPendingChange(database: Database.Database, id: string): PendingChange | undefined {
  const row = database.prepare('SELECT value FROM pending_changes WHERE id = ?').get(id) as
    | { value: string }
    | undefined;
  return row ? decode<PendingChange>(row.value) : undefined;
}

export function listPendingChanges(
  database: Database.Database,
  workId: string | null,
  sessionId: string | null
): PendingChange[] {
  const rows = database
    .prepare(`
    SELECT value FROM pending_changes WHERE status = 'pending'
      AND (? IS NULL OR workId = ?) AND (? IS NULL OR sessionId = ?)
    ORDER BY json_extract(value, '$.order'), id
  `)
    .all(workId, workId, sessionId, sessionId) as { value: string }[];
  return rows.map(row => decode<PendingChange>(row.value));
}

export function putPendingChange(database: Database.Database, change: PendingChange): void {
  database
    .prepare(`
    INSERT INTO pending_changes (id, workId, sessionId, targetType, targetId, status, value)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, value = excluded.value
  `)
    .run(
      change.id,
      change.workId,
      change.sessionId,
      change.target,
      change.targetId,
      change.status,
      JSON.stringify(change)
    );
}

type IntentTable = 'review_intents' | 'review_batch_intents';

/** 意图先于跨库提交保存；恢复只读取已有作品回执，不执行尚未提交的修改。 */
export function putIntent(
  database: Database.Database,
  table: IntentTable,
  input: ReviewIntent | ReviewBatchIntent
): void {
  const row = database.prepare(`SELECT input FROM ${table} WHERE commandId = ?`).get(input.input.commandId) as
    | { input: string }
    | undefined;
  const serialized = JSON.stringify(input);
  if (row && row.input !== serialized) throw new Error('同一命令不能用于不同审阅决定');
  database
    .prepare(`INSERT OR IGNORE INTO ${table} (commandId, input) VALUES (?, ?)`)
    .run(input.input.commandId, serialized);
}

export function listIntents<T>(database: Database.Database, table: IntentTable): T[] {
  const rows = database.prepare(`SELECT input FROM ${table} ORDER BY commandId`).all() as { input: string }[];
  return rows.map(row => decode<T>(row.input));
}
export function clearIntent(database: Database.Database, table: IntentTable, commandId: string): void {
  database.prepare(`DELETE FROM ${table} WHERE commandId = ?`).run(commandId);
}

function decode<T>(value: string): T {
  return JSON.parse(value) as T;
}
