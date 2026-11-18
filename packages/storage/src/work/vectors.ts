import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { StoredVector, VectorIndexTarget } from '@chaptale/creation';

import { workDir } from './database.ts';

/** 向量索引是可以重建的派生数据：单独一个文件放在作品目录下，不随作品库进作品包。 */
function vectorFile(rootDir: string, workId: string): string {
  return path.join(workDir(rootDir, workId), 'vectors.sqlite');
}

/** width 是服务实际返回的向量长度，第一次保存时记下。 */
const schema = `
  CREATE TABLE target (
    id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL, dimensions INTEGER, width INTEGER
  ) STRICT;
  CREATE TABLE vectors (hash TEXT PRIMARY KEY, vector BLOB NOT NULL) STRICT, WITHOUT ROWID;
`;

/**
 * 连接只在一次操作内打开：作品目录会被整体改名或移入回收站，不能留着打开的文件。
 * 作者还没启动建立时没有这个文件，返回 undefined。
 */
function use<T>(rootDir: string, workId: string, action: (database: Database.Database) => T): T | undefined {
  const file = vectorFile(rootDir, workId);
  if (!existsSync(file)) return undefined;
  const database = new Database(file);
  try {
    return action(database);
  } finally {
    database.close();
  }
}

export function readVectorTarget(rootDir: string, workId: string): VectorIndexTarget | undefined {
  return use(
    rootDir,
    workId,
    database => database.prepare('SELECT model, dimensions FROM target').get() as VectorIndexTarget
  );
}

export function startVectorIndex(rootDir: string, workId: string, target: VectorIndexTarget): void {
  const database = new Database(vectorFile(rootDir, workId));
  try {
    database.exec(schema);
    database
      .prepare('INSERT INTO target (id, model, dimensions) VALUES (1, ?, ?)')
      .run(target.model, target.dimensions);
  } finally {
    database.close();
  }
}

export function readVectorHashes(rootDir: string, workId: string): Set<string> {
  return new Set(
    use(rootDir, workId, database => database.prepare('SELECT hash FROM vectors').pluck().all() as string[])
  );
}

export function saveVectors(rootDir: string, workId: string, vectors: readonly StoredVector[]): void {
  const saved = use(rootDir, workId, database =>
    database.transaction(() => {
      const width =
        (database.prepare('SELECT width FROM target').pluck().get() as number | null) ?? vectors[0]?.vector.length;
      if (vectors.some(({ vector }) => vector.length !== width))
        throw new Error('服务返回的向量长度与索引里已有的不一致');
      database.prepare('UPDATE target SET width = ?').run(width);
      const insert = database.prepare('INSERT OR REPLACE INTO vectors (hash, vector) VALUES (?, ?)');
      for (const { hash, vector } of vectors)
        insert.run(hash, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
      return true;
    })()
  );
  if (!saved) throw new Error('这部作品还没有建立向量索引');
}

export function clearVectorIndex(rootDir: string, workId: string): void {
  rmSync(vectorFile(rootDir, workId), { force: true });
}
