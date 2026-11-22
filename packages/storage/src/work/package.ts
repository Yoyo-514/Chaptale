import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  isImageFile,
  type Entry,
  type Work,
  type WorkPackageInfo,
  type WorkSnapshot
} from '@chaptale/creation/contracts';

import { prepareSchema, SchemaVersionError } from '../schema.ts';
import { workDatabaseFile, workDir, workFilesDir, workSchema } from './database.ts';

/** 作品包格式版本；包内作品库的结构版本另由 user_version 记录。 */
const packageFormat = 3;
const packageTables = `
  CREATE TABLE package_sessions (name TEXT PRIMARY KEY, data BLOB NOT NULL) STRICT;
  CREATE TABLE package_skills (path TEXT PRIMARY KEY, data BLOB NOT NULL) STRICT;
  CREATE TABLE package_meta (format INTEGER NOT NULL, work TEXT NOT NULL) STRICT;
  CREATE TABLE package_files (entryId TEXT NOT NULL, fileName TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (entryId, fileName)) STRICT;
`;
/** 覆盖导入前的作品目录：`<workId>.before-import-<时间>`，目录内 work.json 记录当时的作品信息。 */
const snapshotMarker = '.before-import-';
const snapshotWorkFile = 'work.json';

/** 技能正文及其引用以相对路径归档；根目录只取技能目录和停用设置。 */
function archiveSkills(database: Database.Database, root: string): void {
  if (!existsSync(root)) return;
  const insert = database.prepare('INSERT INTO package_skills VALUES (?, ?)');
  function visit(prefix: string): void {
    for (const item of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
      if (!prefix && (item.name === '.trash' || (!item.isDirectory() && item.name !== '.disabled.json'))) continue;
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) visit(relative);
      else insert.run(relative, readFileSync(path.join(root, relative)));
    }
  }
  visit('');
}

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
      const filesDir = workFilesDir(rootDir, work.id);
      target.transaction(() => {
        const insertSession = target.prepare('INSERT INTO package_sessions VALUES (?, ?)');
        // 恢复时跳过仍在本机的会话，两个目录里没有同名历史。
        for (const dir of [path.join(workDir(rootDir, work.id), 'history'), path.join(rootDir, 'sessions', work.id)]) {
          if (!existsSync(dir)) continue;
          for (const item of readdirSync(dir, { withFileTypes: true }))
            if (item.isFile() && item.name.endsWith('.jsonl'))
              insertSession.run(item.name, readFileSync(path.join(dir, item.name)));
        }
        archiveSkills(target, path.join(workDir(rootDir, work.id), 'skills'));
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

/** 读取包信息；不是作品包、包格式与当前不同或结构版本比当前应用新时报错。 */
export function readWorkPackage(file: string): Omit<WorkPackageInfo, 'exists'> {
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const meta = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'package_meta'").get()
      ? (database.prepare('SELECT format, work FROM package_meta').get() as { format: number; work: string })
      : undefined;
    if (!meta) throw new Error('所选文件不是 Chaptale 作品包');
    const version = database.pragma('user_version', { simple: true }) as number;
    if (meta.format < packageFormat) throw new Error('作品包由旧版本的 Chaptale 导出，请用当前版本重新导出');
    if (meta.format > packageFormat || version > workSchema.migrations.length + 1)
      throw new SchemaVersionError('作品包由更新版本的 Chaptale 导出，请升级应用后导入');
    const summary = { manuscripts: 0, resources: 0, images: 0 };
    const entries = database
      .prepare("SELECT section, kind, fileName FROM entries WHERE kind <> 'directory'")
      .iterate() as Iterable<Pick<Entry, 'section' | 'kind' | 'fileName'>>;
    for (const entry of entries) {
      if (entry.section === 'manuscript') summary.manuscripts++;
      else {
        summary.resources++;
        if (isImageFile(entry)) summary.images++;
      }
    }
    return { work: JSON.parse(meta.work) as Work, summary };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_NOTADB')
      throw new Error('所选文件不是 Chaptale 作品包', { cause: error });
    throw error;
  } finally {
    database.close();
  }
}

function stagingDir(rootDir: string, workId: string): string {
  return `${workDir(rootDir, workId)}.importing`;
}

/** 在作品目录旁展开作品包并升级结构；换上目录由 installStagedWork 完成。 */
export function stageWorkPackage(rootDir: string, file: string, workId: string): void {
  const staging = stagingDir(rootDir, workId);
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
        for (const row of source.prepare('SELECT name, data FROM package_sessions').iterate() as Iterable<{
          name: string;
          data: Buffer;
        }>) {
          if (!row.name.endsWith('.jsonl') || /[\\/:]/.test(row.name))
            throw new Error('作品包内容无效：历史名称不合法');
          // 本机会话只追加，已经包含备份时刻的全部记录；同名副本不再恢复。
          if (existsSync(path.join(rootDir, 'sessions', workId, row.name))) continue;
          const dir = path.join(staging, 'history');
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, row.name), row.data);
        }
        for (const skill of source.prepare('SELECT path, data FROM package_skills').iterate() as Iterable<{
          path: string;
          data: Buffer;
        }>) {
          const parts = skill.path.split('/');
          if (parts.some(part => !part || part.includes('\\') || part.includes(':') || /[. ]$/.test(part)))
            throw new Error('作品包内容无效：技能路径不合法');
          const filePath = path.join(staging, 'skills', ...parts);
          mkdirSync(path.dirname(filePath), { recursive: true });
          writeFileSync(filePath, skill.data);
        }
        staged.exec(
          'DROP TABLE package_sessions; DROP TABLE package_skills; DROP TABLE package_meta; DROP TABLE package_files; VACUUM'
        );
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
}

export function discardStagedWork(rootDir: string, workId: string): void {
  rmSync(stagingDir(rootDir, workId), { recursive: true, force: true });
}

/**
 * 换上已展开的作品包。previous 不为空时原作品目录改名为导入前快照并记下当时的作品信息。
 * 返回撤销函数：作品库提交失败时换回原目录，展开的内容随之丢弃（作品包文件仍在）。
 */
export function installStagedWork(rootDir: string, workId: string, previous: Work | null): () => void {
  const target = workDir(rootDir, workId);
  const staging = stagingDir(rootDir, workId);
  if (!previous || !existsSync(target)) {
    renameSync(staging, target);
    return () => rmSync(target, { recursive: true, force: true });
  }
  const snapshot = `${target}${snapshotMarker}${Date.now()}`;
  renameSync(target, snapshot);
  try {
    writeFileSync(path.join(snapshot, snapshotWorkFile), JSON.stringify(previous));
    renameSync(staging, target);
  } catch (error) {
    rmSync(path.join(snapshot, snapshotWorkFile), { force: true });
    renameSync(snapshot, target);
    throw error;
  }
  return () => {
    rmSync(target, { recursive: true, force: true });
    rmSync(path.join(snapshot, snapshotWorkFile), { force: true });
    renameSync(snapshot, target);
  };
}

/** 作品的导入前快照，最新在前。 */
export function workSnapshotDirs(rootDir: string, workId: string): string[] {
  const works = path.join(rootDir, 'works');
  const prefix = `${workId}${snapshotMarker}`;
  return readdirSync(works)
    .filter(name => name.startsWith(prefix))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
    .map(name => path.join(works, name));
}

/** 每部作品最新一份导入前快照。 */
export function listWorkSnapshots(rootDir: string): WorkSnapshot[] {
  const latest = new Map<string, number>();
  for (const name of readdirSync(path.join(rootDir, 'works'))) {
    const at = name.indexOf(snapshotMarker);
    if (at < 0) continue;
    const workId = name.slice(0, at);
    const createdAt = Number(name.slice(at + snapshotMarker.length));
    if (createdAt > (latest.get(workId) ?? 0)) latest.set(workId, createdAt);
  }
  return [...latest].map(([workId, createdAt]) => ({ workId, createdAt }));
}

export function readWorkSnapshot(rootDir: string, workId: string): Work {
  const snapshot = workSnapshotDirs(rootDir, workId)[0];
  if (!snapshot) throw new Error('这部作品没有导入前的内容');
  return JSON.parse(readFileSync(path.join(snapshot, snapshotWorkFile), 'utf8')) as Work;
}

/** 换回最新的导入前快照；当前目录改名后返回，由平台移入系统回收站。返回撤销函数供作品库提交失败时换回。 */
export function restoreWorkSnapshot(rootDir: string, workId: string): { replaced: string; undo: () => void } {
  const snapshot = workSnapshotDirs(rootDir, workId)[0];
  if (!snapshot) throw new Error('这部作品没有导入前的内容');
  const target = workDir(rootDir, workId);
  const replaced = `${target}.replaced-${Date.now()}`;
  const work = readFileSync(path.join(snapshot, snapshotWorkFile));
  renameSync(target, replaced);
  try {
    renameSync(snapshot, target);
    rmSync(path.join(target, snapshotWorkFile));
  } catch (error) {
    if (existsSync(target) && !existsSync(snapshot)) renameSync(target, snapshot);
    renameSync(replaced, target);
    throw error;
  }
  return {
    replaced,
    undo: () => {
      writeFileSync(path.join(target, snapshotWorkFile), work);
      renameSync(target, snapshot);
      renameSync(replaced, target);
    }
  };
}
