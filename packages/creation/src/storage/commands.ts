import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

export const receiptSchema = `
  CREATE TABLE IF NOT EXISTS command_receipts (
    commandId TEXT PRIMARY KEY,
    requestHash TEXT NOT NULL,
    result TEXT NOT NULL
  ) STRICT;
`;

function commandHash(parameters: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parameters)).digest('hex');
}

export function readCommandReceipt<T>(
  database: Database.Database,
  commandId: string,
  parameters: readonly unknown[]
): T | undefined {
  const receipt = database
    .prepare('SELECT requestHash, result FROM command_receipts WHERE commandId = ?')
    .get(commandId) as { requestHash: string; result: string } | undefined;
  if (!receipt) return undefined;
  if (receipt.requestHash !== commandHash(parameters)) throw new Error('同一命令不能用于不同操作或参数');
  return JSON.parse(receipt.result) as T;
}

/** 修改与回执同事务提交；同一命令重试返回原结果，参数变化则拒绝。 */
export function commitCommand<T>(
  database: Database.Database,
  commandId: string,
  parameters: readonly unknown[],
  apply: () => T
): T {
  return database.transaction(() => {
    const receipt = readCommandReceipt<T>(database, commandId, parameters);
    if (receipt !== undefined) return receipt;
    const result = apply();
    database
      .prepare('INSERT INTO command_receipts (commandId, requestHash, result) VALUES (?, ?, ?)')
      .run(commandId, commandHash(parameters), JSON.stringify(result));
    return result;
  })();
}
