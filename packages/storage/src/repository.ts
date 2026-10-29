import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

import type { CommandCommit, CommitEffect, CommitResult, CreationRepository } from '@chaptale/creation';
import type { CreationChanges, CreationCursor, CreationSnapshot } from '@chaptale/creation/contracts';

import { commitCommand, readChanges, readCursor } from './commands.ts';
import { openLibrary } from './library/database.ts';
import { SqliteLibraryRepository } from './library/repository.ts';
import { openWorkDatabase, workDatabaseFile, workDir } from './work/database.ts';
import { SqliteWorkRepository } from './work/repository.ts';

export async function openCreationStorage(options: { rootDir: string }): Promise<CreationRepository> {
  return new SqliteCreationRepository(options.rootDir, await openLibrary(options.rootDir));
}

/** 组装本机库与作品库；同一时间只保持当前作品的一个作品库连接。 */
class SqliteCreationRepository implements CreationRepository {
  readonly library: SqliteLibraryRepository;
  private readonly rootDir: string;
  private readonly libraryDatabase: Database.Database;
  private current?: { id: string; database: Database.Database };

  constructor(rootDir: string, libraryDatabase: Database.Database) {
    this.rootDir = rootDir;
    this.libraryDatabase = libraryDatabase;
    this.library = new SqliteLibraryRepository(libraryDatabase, workId => this.latestEntryUpdate(workId));
  }

  work(workId: string): SqliteWorkRepository {
    return new SqliteWorkRepository(this.rootDir, workId, () => this.useWork(workId));
  }

  command<T extends CommitResult>(
    workId: string | null,
    commandId: string,
    parameters: readonly unknown[],
    effect: CommitEffect,
    apply: () => T
  ): CommandCommit<T> {
    return commitCommand(this.database(workId), workId, commandId, parameters, effect, apply);
  }

  snapshot(workId: string | null): CreationSnapshot {
    const database = this.database(workId);
    return database.transaction((): CreationSnapshot => {
      const cursor = readCursor(database, workId);
      return workId === null
        ? { kind: 'library', cursor, works: this.library.listWorks() }
        : {
            kind: 'work',
            workId,
            cursor,
            entries: this.work(workId).listEntries(),
            records: this.work(workId).listRecords()
          };
    })();
  }

  readChanges(cursor: CreationCursor, limit: number): CreationChanges {
    return readChanges(this.database(cursor.workId), cursor, limit);
  }

  releaseWork(workId: string): string[] {
    if (this.current?.id === workId) {
      this.current.database.close();
      this.current = undefined;
    }
    const dir = workDir(this.rootDir, workId);
    return existsSync(dir) ? [dir] : [];
  }

  close(): void {
    this.current?.database.close();
    this.libraryDatabase.close();
  }

  private database(workId: string | null): Database.Database {
    return workId === null ? this.libraryDatabase : this.useWork(workId);
  }

  private useWork(workId: string): Database.Database {
    if (this.current?.id === workId) return this.current.database;
    if (!this.libraryDatabase.prepare('SELECT id FROM works WHERE id = ?').get(workId)) throw new Error('作品不存在');
    const database = openWorkDatabase(this.rootDir, workId);
    this.current?.database.close();
    this.current = { id: workId, database };
    return database;
  }

  /** 作品列表的更新时间：当前作品沿用已有连接，其他作品临时只读打开，不替换当前连接；从未打开过的作品没有条目。 */
  private latestEntryUpdate(workId: string): number | null {
    const query = 'SELECT max(updatedAt) AS updatedAt FROM entries';
    if (this.current?.id === workId)
      return (this.current.database.prepare(query).get() as { updatedAt: number | null }).updatedAt;
    const file = workDatabaseFile(this.rootDir, workId);
    if (!existsSync(file)) return null;
    const database = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return (database.prepare(query).get() as { updatedAt: number | null }).updatedAt;
    } finally {
      database.close();
    }
  }
}
