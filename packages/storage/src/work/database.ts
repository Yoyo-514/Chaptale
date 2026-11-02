import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { receiptSchema } from '../commands.ts';
import { prepareSchema, type SchemaPlan } from '../schema.ts';
import { recordSchema } from './records.ts';
import { relationSchema } from './relations.ts';
import { trashSchema } from './trash.ts';

/** 一个作品一个目录：作品库与资料文件条目都放在这里。 */
export function workDir(rootDir: string, workId: string): string {
  return path.join(rootDir, 'works', workId);
}

/** 文件条目独占一个子目录，文件保留添加时的原文件名。 */
export function entryFileDir(rootDir: string, workId: string, entryId: string): string {
  return path.join(workDir(rootDir, workId), 'files', entryId);
}

export function workDatabaseFile(rootDir: string, workId: string): string {
  return path.join(workDir(rootDir, workId), 'work.sqlite');
}

export function openWorkDatabase(rootDir: string, workId: string): Database.Database {
  mkdirSync(workDir(rootDir, workId), { recursive: true });
  const file = workDatabaseFile(rootDir, workId);
  const database = new Database(file);
  try {
    database.pragma('foreign_keys = ON');
    prepareSchema(database, file, workSchema);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

/** 作品库结构；作品包与本机作品目录共用。 */
export const workSchema: SchemaPlan = {
  label: '作品库',
  create(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      parentId TEXT REFERENCES entries(id),
      section TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL,
      format TEXT,
      fileName TEXT,
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
    CREATE TABLE IF NOT EXISTS resource_attributes (
      entryId TEXT PRIMARY KEY REFERENCES entries(id),
      type TEXT NOT NULL,
      aliases TEXT NOT NULL,
      tags TEXT NOT NULL,
      cover TEXT
    ) STRICT;
    CREATE VIRTUAL TABLE document_search USING fts5(entryId UNINDEXED, title, content);
  `);
    database.exec(recordSchema);
    database.exec(relationSchema);
    database.exec(trashSchema);
    database.exec(receiptSchema);
  },
  migrations: []
};
