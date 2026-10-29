import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { receiptSchema } from '../commands.ts';

export async function openLibrary(rootDir: string): Promise<Database.Database> {
  await mkdir(path.join(rootDir, 'works'), { recursive: true });
  const database = new Database(path.join(rootDir, 'library.sqlite'));
  database.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS recovery_drafts (
      workId TEXT NOT NULL REFERENCES works(id),
      documentId TEXT NOT NULL,
      version TEXT NOT NULL,
      draft TEXT,
      PRIMARY KEY (workId, documentId)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS work_trash (
      workId TEXT PRIMARY KEY REFERENCES works(id),
      deletedAt INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS session_assignments (
      sessionId TEXT PRIMARY KEY,
      workId TEXT NOT NULL REFERENCES works(id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS session_selections (
      scopeId TEXT PRIMARY KEY,
      sessionId TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS review_intents (
      commandId TEXT PRIMARY KEY,
      input TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS delivery_intents (
      commandId TEXT PRIMARY KEY,
      input TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pending_changes (
      id TEXT PRIMARY KEY,
      workId TEXT NOT NULL REFERENCES works(id),
      sessionId TEXT NOT NULL,
      targetType TEXT NOT NULL,
      targetId TEXT NOT NULL,
      status TEXT NOT NULL,
      value TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS pending_changes_target
      ON pending_changes(workId, sessionId, targetType, targetId) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS delivery_groups (
      sequence INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      sessionId TEXT NOT NULL,
      value TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS delivery_groups_session ON delivery_groups(sessionId, sequence DESC);
    CREATE TABLE IF NOT EXISTS workbench_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL
    ) STRICT;
  `);
  database.exec(receiptSchema);
  return database;
}
