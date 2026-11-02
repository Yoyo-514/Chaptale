import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Work } from '@chaptale/creation/contracts';

import { prepareSchema, SchemaVersionError } from '../schema.ts';
import { workDatabaseFile, workDir, workSchema } from './database.ts';

/** 作品包格式版本；包内作品库的结构版本另由 user_version 记录。 */
const packageFormat = 1;
const packageTables = `
  CREATE TABLE package_meta (format INTEGER NOT NULL, work TEXT NOT NULL) STRICT;
  CREATE TABLE package_files (entryId TEXT NOT NULL, fileName TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (entryId, fileName)) STRICT;
`;

/** 作品包是一个 SQLite 文件：作品库的一致快照，加上包信息与资料文件条目。先写临时文件，完成后再换上目标路径。 */
export function exportWorkPackage(rootDir: string, database: Database.Database, work: Work, file: string): void {
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  try {
    database.prepare('VACUUM INTO ?').run(partial);
    const target = new Database(partial);
    try {
      target.pragma(`user_version = ${database.pragma('user_version', { simple: true }) as number}`);
      target.exec(packageTables);
      target.prepare('INSERT INTO package_meta VALUES (?, ?)').run(packageFormat, JSON.stringify(work));
      const insert = target.prepare('INSERT INTO package_files VALUES (?, ?, ?)');
      const filesDir = path.join(workDir(rootDir, work.id), 'files');
      target.transaction(() => {
        if (!existsSync(filesDir)) return;
        for (const entryId of readdirSync(filesDir))
          for (const fileName of readdirSync(path.join(filesDir, entryId)))
            insert.run(entryId, fileName, readFileSync(path.join(filesDir, entryId, fileName)));
      })();
    } finally {
      target.close();
    }
    rmSync(file, { force: true });
    renameSync(partial, file);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

/** 读取包信息；不是作品包、包格式或结构版本比当前应用新时报错。 */
export function readWorkPackage(file: string): Work {
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const meta = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'package_meta'").get()
      ? (database.prepare('SELECT format, work FROM package_meta').get() as { format: number; work: string })
      : undefined;
    if (!meta) throw new Error('所选文件不是 Chaptale 作品包');
    const version = database.pragma('user_version', { simple: true }) as number;
    if (meta.format > packageFormat || version > workSchema.migrations.length + 1)
      throw new SchemaVersionError('作品包由更新版本的 Chaptale 导出，请升级应用后导入');
    return JSON.parse(meta.work) as Work;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_NOTADB')
      throw new Error('所选文件不是 Chaptale 作品包', { cause: error });
    throw error;
  } finally {
    database.close();
  }
}

/**
 * 把作品包展开为 workId 的作品目录：先在旁边的临时目录展开并升级结构，再换上。
 * 覆盖时原作品目录改名为 `<workId>.before-import-<时间>` 留作恢复快照，换上失败时改回。返回快照目录。
 */
export function installWorkPackage(rootDir: string, file: string, workId: string, replace: boolean): string | null {
  const target = workDir(rootDir, workId);
  const staging = `${target}.importing`;
  rmSync(staging, { recursive: true, force: true });
  try {
    mkdirSync(staging, { recursive: true });
    const stagedFile = path.join(staging, path.basename(workDatabaseFile(rootDir, workId)));
    const source = new Database(file, { readonly: true, fileMustExist: true });
    try {
      source.prepare('VACUUM INTO ?').run(stagedFile);
      const staged = new Database(stagedFile);
      try {
        staged.pragma(`user_version = ${source.pragma('user_version', { simple: true }) as number}`);
        for (const row of source.prepare('SELECT entryId, fileName, data FROM package_files').iterate() as Iterable<{
          entryId: string;
          fileName: string;
          data: Buffer;
        }>) {
          // 包来自外部文件，文件名只能落在该条目自己的目录内。
          if (path.basename(row.entryId) !== row.entryId || path.basename(row.fileName) !== row.fileName)
            throw new Error('作品包内容无效：文件路径不合法');
          const dir = path.join(staging, 'files', row.entryId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, row.fileName), row.data);
        }
        staged.exec('DROP TABLE package_meta; DROP TABLE package_files; VACUUM');
        staged.pragma('foreign_keys = ON');
        prepareSchema(staged, stagedFile, workSchema);
      } finally {
        staged.close();
      }
    } finally {
      source.close();
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  if (!replace || !existsSync(target)) {
    renameSync(staging, target);
    return null;
  }
  const snapshot = `${target}.before-import-${Date.now()}`;
  renameSync(target, snapshot);
  try {
    renameSync(staging, target);
  } catch (error) {
    renameSync(snapshot, target);
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return snapshot;
}
