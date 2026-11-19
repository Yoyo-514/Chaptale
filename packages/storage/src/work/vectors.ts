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

/** 逐行读出向量算余弦相似度，不把整个索引留在内存里。 */
export function scoreVectors(rootDir: string, workId: string, question: Float32Array): Map<string, number> {
  const scores = new Map<string, number>();
  use(rootDir, workId, database => {
    const width = database.prepare('SELECT width FROM target').pluck().get() as number | null;
    if (width === null) return;
    if (question.length !== width) throw new Error('问题的向量长度与索引里已有的不一致');
    let questionSquare = 0;
    for (const value of question) questionSquare += value * value;
    // BLOB 在内存里的起始位置不一定按 4 字节对齐，逐行拷进同一块缓冲后再按浮点数读。
    const vector = new Float32Array(width);
    const bytes = new Uint8Array(vector.buffer);
    const rows = database.prepare('SELECT hash, vector FROM vectors').iterate() as IterableIterator<{
      hash: string;
      vector: Buffer;
    }>;
    for (const row of rows) {
      bytes.set(row.vector);
      let dot = 0;
      let square = 0;
      for (let index = 0; index < width; index++) {
        dot += vector[index]! * question[index]!;
        square += vector[index]! * vector[index]!;
      }
      const norm = Math.sqrt(square * questionSquare);
      scores.set(row.hash, norm === 0 ? 0 : dot / norm);
    }
  });
  return scores;
}

export function clearVectorIndex(rootDir: string, workId: string): void {
  rmSync(vectorFile(rootDir, workId), { force: true });
}
