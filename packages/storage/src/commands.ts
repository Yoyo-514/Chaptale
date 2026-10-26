import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

import type { CommandCommit, CommitEffect, CommitResult } from '@chaptale/creation';
import type {
  CreationChanges,
  CreationCursor,
  CreationEvent,
  DeliveryGroup,
  Entry,
  PendingChange,
  Work
} from '@chaptale/creation/contracts';

export const receiptSchema = `
  CREATE TABLE IF NOT EXISTS command_receipts (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    commandId TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    committedAt INTEGER NOT NULL,
    requestHash TEXT NOT NULL,
    result TEXT NOT NULL,
    effect TEXT NOT NULL
  ) STRICT;
`;

interface ReceiptRow {
  sequence: number;
  commandId: string;
  token: string;
  committedAt: number;
  requestHash: string;
  result: string;
  effect: string;
}

function commandHash(parameters: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parameters)).digest('hex');
}

function receipt(
  database: Database.Database,
  commandId: string,
  parameters: readonly unknown[]
): ReceiptRow | undefined {
  const row = database.prepare('SELECT * FROM command_receipts WHERE commandId = ?').get(commandId) as
    | ReceiptRow
    | undefined;
  if (row && row.requestHash !== commandHash(parameters)) throw new Error('同一命令不能用于不同操作或参数');
  return row;
}

/** 回执按写入时的业务类型读取；损坏时由应用入口报告失败。 */
export function readCommandReceipt<T>(
  database: Database.Database,
  commandId: string,
  parameters: readonly unknown[]
): T | undefined {
  const row = receipt(database, commandId, parameters);
  return row ? (JSON.parse(row.result) as T) : undefined;
}

function eventFrom(workId: string | null, row: ReceiptRow): CreationEvent {
  const effect = JSON.parse(row.effect) as CommitEffect;
  const result = JSON.parse(row.result) as CommitResult;
  return {
    cursor: { workId, sequence: row.sequence, token: row.token },
    commandId: row.commandId,
    committedAt: row.committedAt,
    change: changeFrom(effect, result)
  };
}

function changeFrom(effect: CommitEffect, result: CommitResult): CreationEvent['change'] {
  if (effect.kind === 'work') return { kind: 'work', work: result as Work };
  if (effect.kind === 'review') return { kind: 'review', change: result as PendingChange };
  if (effect.kind === 'delivery') return { kind: 'delivery', group: result as DeliveryGroup };
  if (effect.kind === 'entries') return { kind: 'entries', entries: result as Entry[] };
  return { ...effect, entry: result as Entry };
}

/** 修改、提交身份与回执一次提交；结果只存一份，事件复用回执元数据。 */
export function commitCommand<T extends CommitResult>(
  database: Database.Database,
  workId: string | null,
  commandId: string,
  parameters: readonly unknown[],
  effect: CommitEffect,
  apply: () => T
): CommandCommit<T> {
  return database.transaction(() => {
    const existing = receipt(database, commandId, parameters);
    if (existing) return { result: JSON.parse(existing.result) as T, event: eventFrom(workId, existing), fresh: false };
    const result = apply();
    const stored = {
      commandId,
      token: randomUUID(),
      committedAt: Date.now(),
      requestHash: commandHash(parameters),
      result: JSON.stringify(result),
      effect: JSON.stringify(effect)
    };
    const inserted = database
      .prepare(`
      INSERT INTO command_receipts (commandId, token, committedAt, requestHash, result, effect)
      VALUES (@commandId, @token, @committedAt, @requestHash, @result, @effect)
    `)
      .run(stored);
    return { result, event: eventFrom(workId, { ...stored, sequence: Number(inserted.lastInsertRowid) }), fresh: true };
  })();
}

export function readCursor(database: Database.Database, workId: string | null): CreationCursor {
  const row = database.prepare('SELECT sequence, token FROM command_receipts ORDER BY sequence DESC LIMIT 1').get() as
    | { sequence: number; token: string }
    | undefined;
  return row ? { workId, ...row } : { workId, sequence: 0, token: null };
}

/** 序号只在对应数据库内递增；提交 token 防止旧备份恢复后复用序号。 */
export function readChanges(database: Database.Database, cursor: CreationCursor, limit: number): CreationChanges {
  return database.transaction((): CreationChanges => {
    if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0) return { kind: 'snapshot-required' };
    if (cursor.sequence === 0) {
      if (cursor.token !== null) return { kind: 'snapshot-required' };
    } else {
      const previous = database
        .prepare('SELECT token FROM command_receipts WHERE sequence = ?')
        .get(cursor.sequence) as { token: string } | undefined;
      if (!previous || previous.token !== cursor.token) return { kind: 'snapshot-required' };
    }
    const rows = database
      .prepare('SELECT * FROM command_receipts WHERE sequence > ? ORDER BY sequence LIMIT ?')
      .all(cursor.sequence, limit + 1) as ReceiptRow[];
    const events = rows.slice(0, limit).map(row => eventFrom(cursor.workId, row));
    return {
      kind: 'changes',
      events,
      hasMore: rows.length > limit,
      cursor: events.at(-1)?.cursor ?? { ...cursor }
    };
  })();
}
