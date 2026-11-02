import Database from 'better-sqlite3';

/** 库的结构版本无法打开或升级；消息写明哪个库与原因，可直接展示给作者。 */
export class SchemaVersionError extends Error {}

/** 一种库的结构：create 建立第 1 版；migrations[i] 把第 i + 1 版升级到第 i + 2 版。 */
export interface SchemaPlan {
  /** 报错时称呼这个库，如“作品库”。 */
  label: string;
  create(database: Database.Database): void;
  migrations: readonly ((database: Database.Database) => void)[];
}

/**
 * 按 user_version 准备结构：空库建到当前版本；旧版本先把库复制为 `<file>.v<旧版本>.bak` 再逐版迁移，失败时回滚；
 * 版本更新的库拒绝打开。本机制之前创建的库没有版本记录，结构与第 1 版一致时认作第 1 版，否则拒绝。
 */
export function prepareSchema(database: Database.Database, file: string, plan: SchemaPlan): void {
  const current = plan.migrations.length + 1;
  let version = database.pragma('user_version', { simple: true }) as number;
  if (version > current)
    throw new SchemaVersionError(`${plan.label}由更新版本的 Chaptale 创建（结构第 ${version} 版），请升级应用后打开`);
  if (version === current) return;
  if (version === 0) {
    if (shape(database).size === 0) {
      database.transaction(() => {
        plan.create(database);
        for (const migrate of plan.migrations) migrate(database);
        database.pragma(`user_version = ${current}`);
      })();
      return;
    }
    if (!sameShape(database, plan))
      throw new SchemaVersionError(`${plan.label}没有结构版本记录，且与第 1 版结构不一致，无法打开`);
    version = 1;
    database.pragma('user_version = 1');
    if (version === current) return;
  }
  database.prepare('VACUUM INTO ?').run(`${file}.v${version}.bak`);
  try {
    database.transaction(() => {
      for (const migrate of plan.migrations.slice(version - 1)) migrate(database);
      database.pragma(`user_version = ${current}`);
    })();
  } catch (error) {
    throw new SchemaVersionError(
      `${plan.label}从第 ${version} 版升级失败，原库未改动：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** 库中的表、索引、触发器与建立语句，空白统一后比较。 */
function shape(database: Database.Database): Map<string, string> {
  const rows = database.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as {
    type: string;
    name: string;
    sql: string | null;
  }[];
  return new Map(rows.map(row => [`${row.type} ${row.name}`, (row.sql ?? '').replace(/\s+/g, ' ')]));
}

function sameShape(database: Database.Database, plan: SchemaPlan): boolean {
  const baseline = new Database(':memory:');
  try {
    plan.create(baseline);
    const expected = shape(baseline);
    const actual = shape(database);
    return actual.size === expected.size && [...expected].every(([key, sql]) => actual.get(key) === sql);
  } finally {
    baseline.close();
  }
}
