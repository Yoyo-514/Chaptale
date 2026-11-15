import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';

import { openCreationStorage, SchemaVersionError } from '../index.ts';
import { prepareSchema, type SchemaPlan } from '../schema.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function root() {
  const dir = await mkdtemp(join(tmpdir(), 'chaptale-schema-'));
  roots.push(dir);
  return dir;
}
function version(file: string) {
  const database = new Database(file, { readonly: true });
  try {
    return database.pragma('user_version', { simple: true });
  } finally {
    database.close();
  }
}
function setVersion(file: string, statement: string) {
  const database = new Database(file);
  database.exec(statement);
  database.close();
}
async function withWork(rootDir: string) {
  const app = new CreationApplication(await openCreationStorage({ rootDir }));
  const work = app.executeAuthor({
    method: 'createWork',
    input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
  });
  if (!work.ok) throw new Error(work.error.message);
  const entry = app.executeAuthor({
    method: 'createEntry',
    input: {
      commandId: randomUUID(),
      workId: work.value.id,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '第一章',
      format: 'txt',
      content: '夜里下着雨。'
    }
  });
  if (!entry.ok) throw new Error(entry.error.message);
  app.close();
  return { workId: work.value.id, file: join(rootDir, 'works', work.value.id, 'work.sqlite') };
}

/** 恢复真实第 1/2 版的审阅表形状，用于验证结构升级。 */
const legacyReviewSchema = `
  DROP TABLE review_results;
  DROP TABLE review_batch_intents;
  CREATE TABLE delivery_intents (
    commandId TEXT PRIMARY KEY,
    input TEXT NOT NULL
  ) STRICT;
  CREATE TABLE delivery_groups (
    sequence INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    sessionId TEXT NOT NULL,
    value TEXT NOT NULL
  ) STRICT;
  CREATE INDEX delivery_groups_session ON delivery_groups(sessionId, sequence DESC);
`;

it('历史本机库与作品库逐版升级到当前版本时清理退场结构与旧布局缓存，保留既有内容并留下备份', async () => {
  const dir = await root();
  const { workId, file } = await withWork(dir);
  const currentVersion = version(join(dir, 'library.sqlite')) as number;
  const currentWorkVersion = version(file) as number;
  expect(currentVersion).toBeGreaterThanOrEqual(4);
  expect(currentWorkVersion).toBeGreaterThanOrEqual(2);
  const library = join(dir, 'library.sqlite');
  const sessionId = randomUUID();
  setVersion(
    library,
    legacyReviewSchema +
      `PRAGMA user_version = 1; CREATE TABLE session_assignments (
      sessionId TEXT PRIMARY KEY,
      workId TEXT NOT NULL REFERENCES works(id)
    ) STRICT; INSERT INTO session_assignments VALUES ('${sessionId}', '${workId}');
    INSERT INTO session_selections VALUES ('${workId}', '${sessionId}');
    INSERT OR REPLACE INTO workbench_state (id, state) VALUES (1, '{"legacy":true}')`
  );
  setVersion(file, 'DROP TABLE work_settings; PRAGMA user_version = 1');
  const app = new CreationApplication(await openCreationStorage({ rootDir: dir }));
  expect(app.executeAuthor({ method: 'listWorks', input: {} })).toMatchObject({ ok: true, value: [{ id: workId }] });
  expect(app.executeAuthor({ method: 'readSessionState', input: {} })).toEqual({
    ok: true,
    value: { selections: [{ workId, sessionId }] }
  });
  expect(app.executeAuthor({ method: 'readWorkbench', input: {} })).toEqual({
    ok: true,
    value: { activeWorkId: null, works: [] }
  });
  expect(app.executeAuthor({ method: 'readWritingGuidelines', input: { workId } })).toEqual({
    ok: true,
    value: ''
  });
  expect(
    app.executeAuthor({
      method: 'writeWritingGuidelines',
      input: { commandId: randomUUID(), workId, writingGuidelines: '第三人称限知视角。' }
    })
  ).toEqual({ ok: true, value: { writingGuidelines: '第三人称限知视角。' } });
  app.close();
  expect(version(library)).toBe(currentVersion);
  expect(version(file)).toBe(currentWorkVersion);
  expect(existsSync(`${library}.v1.bak`)).toBe(true);
  expect(existsSync(`${file}.v1.bak`)).toBe(true);
  const database = new Database(library, { readonly: true });
  expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'session_assignments'").all()).toEqual([]);
  database.close();
});

it('没有版本记录的已有库结构一致时认作第 1 版并保留内容；结构不一致时拒绝打开', async () => {
  const dir = await root();
  const { workId, file } = await withWork(dir);
  const currentVersion = version(join(dir, 'library.sqlite')) as number;
  const currentWorkVersion = version(file) as number;
  // 版本机制之前的本机库与作品库都是第 1 版结构。
  setVersion(
    join(dir, 'library.sqlite'),
    legacyReviewSchema +
      `PRAGMA user_version = 0; CREATE TABLE session_assignments (
      sessionId TEXT PRIMARY KEY,
      workId TEXT NOT NULL REFERENCES works(id)
    ) STRICT`
  );
  setVersion(file, 'DROP TABLE work_settings; PRAGMA user_version = 0');
  const app = new CreationApplication(await openCreationStorage({ rootDir: dir }));
  const listed = app.executeAuthor({ method: 'listEntries', input: { workId } });
  expect(listed).toMatchObject({ ok: true, value: [{ title: '第一章' }] });
  app.close();
  expect(version(join(dir, 'library.sqlite'))).toBe(currentVersion);
  expect(version(file)).toBe(currentWorkVersion);

  setVersion(file, 'DROP TABLE work_settings; PRAGMA user_version = 0; ALTER TABLE entries ADD COLUMN extra TEXT');
  const reopened = new CreationApplication(await openCreationStorage({ rootDir: dir }));
  expect(reopened.executeAuthor({ method: 'listEntries', input: { workId } })).toEqual({
    ok: false,
    error: { code: 'failed', message: '作品库没有结构版本记录，且与第 1 版结构不一致，无法打开' }
  });
  reopened.close();
});

it('版本更新的库拒绝打开：作品库只影响该作品，本机库让启动失败', async () => {
  const dir = await root();
  const { workId, file } = await withWork(dir);
  setVersion(file, 'PRAGMA user_version = 9');
  const app = new CreationApplication(await openCreationStorage({ rootDir: dir }));
  expect(app.executeAuthor({ method: 'listWorks', input: {} })).toMatchObject({ ok: true, value: [{ id: workId }] });
  expect(app.executeAuthor({ method: 'listEntries', input: { workId } })).toMatchObject({
    ok: false,
    error: { message: '作品库由更新版本的 Chaptale 创建（结构第 9 版），请升级应用后打开' }
  });
  app.close();
  expect(version(file)).toBe(9);

  setVersion(join(dir, 'library.sqlite'), 'PRAGMA user_version = 9');
  const opening = openCreationStorage({ rootDir: dir });
  await expect(opening).rejects.toBeInstanceOf(SchemaVersionError);
  await expect(opening).rejects.toThrow('本机库由更新版本的 Chaptale 创建（结构第 9 版），请升级应用后打开');
});

const plan = (migrations: SchemaPlan['migrations']): SchemaPlan => ({
  label: '测试库',
  create: database => database.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, text TEXT NOT NULL) STRICT'),
  migrations
});

it('旧版本先留备份再逐版迁移；空库直接建到当前版本', async () => {
  const file = join(await root(), 'test.sqlite');
  const database = new Database(file);
  prepareSchema(database, file, plan([]));
  database.prepare('INSERT INTO notes VALUES (?, ?)').run('a', '旧内容');
  const upgraded = plan([
    db => db.exec("ALTER TABLE notes ADD COLUMN tag TEXT NOT NULL DEFAULT ''"),
    db => db.exec("UPDATE notes SET tag = '二'")
  ]);
  prepareSchema(database, file, upgraded);
  expect(database.pragma('user_version', { simple: true })).toBe(3);
  expect(database.prepare('SELECT text, tag FROM notes').all()).toEqual([{ text: '旧内容', tag: '二' }]);
  database.close();
  const backup = new Database(`${file}.v1.bak`, { readonly: true });
  expect(backup.pragma('user_version', { simple: true })).toBe(1);
  expect(backup.prepare('SELECT * FROM notes').all()).toEqual([{ id: 'a', text: '旧内容' }]);
  backup.close();

  const freshFile = join(await root(), 'fresh.sqlite');
  const fresh = new Database(freshFile);
  prepareSchema(fresh, freshFile, upgraded);
  expect(fresh.pragma('user_version', { simple: true })).toBe(3);
  expect(fresh.prepare("SELECT name FROM pragma_table_info('notes')").pluck().all()).toEqual(['id', 'text', 'tag']);
  fresh.close();
  expect(existsSync(`${freshFile}.v1.bak`)).toBe(false);
});

it('迁移中途失败时整体回滚，原库内容与版本不变', async () => {
  const file = join(await root(), 'test.sqlite');
  const database = new Database(file);
  prepareSchema(database, file, plan([]));
  database.prepare('INSERT INTO notes VALUES (?, ?)').run('a', '旧内容');
  const failing = plan([
    db => db.exec("ALTER TABLE notes ADD COLUMN tag TEXT NOT NULL DEFAULT ''"),
    db => db.exec('INSERT INTO missing VALUES (1)')
  ]);
  expect(() => prepareSchema(database, file, failing)).toThrow(
    /^测试库从第 1 版升级失败，原库未改动：no such table: missing$/
  );
  expect(database.pragma('user_version', { simple: true })).toBe(1);
  expect(database.prepare("SELECT name FROM pragma_table_info('notes')").pluck().all()).toEqual(['id', 'text']);
  database.close();
});
