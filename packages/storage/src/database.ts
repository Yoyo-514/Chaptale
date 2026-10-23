import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { receiptSchema } from './commands';
import { openSearchIndex } from './search.ts';

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
    CREATE TABLE IF NOT EXISTS pending_changes (
      id TEXT PRIMARY KEY,
      workId TEXT NOT NULL REFERENCES works(id),
      sessionId TEXT NOT NULL,
      entryId TEXT NOT NULL,
      status TEXT NOT NULL,
      value TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS pending_changes_target
      ON pending_changes(workId, sessionId, entryId) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS workbench_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL
    ) STRICT;
  `);
  database.exec(receiptSchema);
  return database;
}

export function openWorkDatabase(rootDir: string, workId: string): Database.Database {
  const database = new Database(path.join(rootDir, 'works', `${workId}.sqlite`));
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      parentId TEXT REFERENCES entries(id),
      section TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      format TEXT,
      content TEXT,
      wordCount INTEGER NOT NULL,
      revisionId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS entries_parent ON entries(section, parentId, position);
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      entryId TEXT NOT NULL REFERENCES entries(id),
      parentRevisionId TEXT,
      source TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    ) STRICT;
  `);
  database.exec(receiptSchema);
  openSearchIndex(database);
  return database;
}
