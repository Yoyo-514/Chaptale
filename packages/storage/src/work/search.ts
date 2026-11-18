import type Database from 'better-sqlite3';

import type { WorkSearchMatches, WorkSearchQuery } from '@chaptale/creation';
import type { Revision } from '@chaptale/creation/contracts';

/**
 * 正式索引不保存文字副本：检索只取条目和相关度，段落从正文里切。
 * 这种表读不回列值，条目与索引行的对应关系另存在 indexed_entries。
 */
export const searchSchema = `
  CREATE TABLE indexed_entries (id INTEGER PRIMARY KEY, entryId TEXT NOT NULL UNIQUE) STRICT;
  CREATE VIRTUAL TABLE document_search USING fts5(title, content, content='', contentless_delete=1);
`;

/** 标点和换行处的占位词，关键词不会跨过它匹配；取自 Unicode 私用区，FTS5 把它当作一个词。 */
const boundary = '\uE000';
/** 关键词之间、原文里隔断关键词的字符：空白、标点和符号。 */
const separators = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * 汉字逐字进索引，其余文字由 FTS5 按词切分；关键词按相邻的字匹配，等同于字面包含。
 * 按词索引时，“沈霁在城门外等候”里的“沈霁在”会被切成一个词，查“沈霁”找不到这一句。
 */
function indexed(text: string): string {
  return text
    .replace(separators, run => (/^[ \t]+$/.test(run) ? ' ' : ` ${boundary} `))
    .replace(/\p{Script=Han}/gu, ' $& ');
}

/** 涉及资料的名称：标题与别名各占一行，搜别名能找到对应资料。 */
function names(title: string, aliases: readonly string[]): string {
  return [title, ...aliases].join('\n');
}

/** 条目移出检索；不在索引中的条目不受影响。 */
export function unindexDocument(database: Database.Database, entryId: string): void {
  database
    .prepare('DELETE FROM document_search WHERE rowid = (SELECT id FROM indexed_entries WHERE entryId = ?)')
    .run(entryId);
  database.prepare('DELETE FROM indexed_entries WHERE entryId = ?').run(entryId);
}

/** 文稿与资料按标题、别名和正文检索；文件条目只按名称检索。 */
export function indexDocument(database: Database.Database, document: Revision['snapshot']): void {
  if (document.kind === 'directory') return;
  unindexDocument(database, document.id);
  const { lastInsertRowid } = database.prepare('INSERT INTO indexed_entries (entryId) VALUES (?)').run(document.id);
  database
    .prepare('INSERT INTO document_search (rowid, title, content) VALUES (?, ?, ?)')
    .run(
      lastInsertRowid,
      indexed(names(document.title, document.attributes?.aliases ?? [])),
      indexed(document.content ?? '')
    );
}

/**
 * 会话候选、事件和关系只进入连接内的临时索引，检索结束即清空，不污染正式索引。
 * 事件和关系数量有限且随进度截取，每次按调用方给出的范围现建。
 */
export function searchWork(database: Database.Database, input: WorkSearchQuery): WorkSearchMatches {
  const words = [...new Set(input.query.split(separators).filter(word => /[\p{L}\p{N}]/u.test(word)))];
  if (!words.length) return { terms: [], matches: [], hasMore: false };
  // 每个关键词是一个短语，各字须在原文中相邻；关键词里没有标点，不会被解释成 MATCH 运算符或列选择语法。
  const query = words.map(word => `"${indexed(word)}"`).join(' AND ');
  return database.transaction(() => {
    database.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS temp.session_search USING fts5(kind UNINDEXED, id UNINDEXED, section UNINDEXED, title, content)'
    );
    const insert = database.prepare(
      'INSERT INTO temp.session_search (kind, id, section, title, content) VALUES (?, ?, ?, ?, ?)'
    );
    const resourceNames = new Map<string, string>();
    for (const candidate of input.candidates) {
      if (candidate.kind === 'directory') continue;
      const title = names(candidate.title, candidate.attributes?.aliases ?? []);
      resourceNames.set(candidate.id, title);
      insert.run('entry', candidate.id, candidate.section, indexed(title), indexed(candidate.content ?? ''));
    }
    if (input.notes.length) {
      const formal = database
        .prepare(
          `SELECT e.id, e.title, a.aliases FROM entries e LEFT JOIN resource_attributes a ON a.entryId = e.id
          WHERE e.id IN (SELECT value FROM json_each(?))`
        )
        .all(JSON.stringify([...new Set(input.notes.flatMap(note => note.resourceIds))])) as {
        id: string;
        title: string;
        aliases: string | null;
      }[];
      for (const { id, title, aliases } of formal)
        if (!resourceNames.has(id))
          resourceNames.set(id, names(title, aliases === null ? [] : (JSON.parse(aliases) as string[])));
      for (const note of input.notes)
        insert.run(
          note.kind,
          note.id,
          '',
          indexed(note.resourceIds.map(id => resourceNames.get(id) ?? '').join('\n')),
          indexed(note.text)
        );
    }
    const section = input.section ?? null;
    // 候选覆盖同一条目的正式索引，隐藏的条目不参与。
    const replaced = JSON.stringify([...input.candidates.map(candidate => candidate.id), ...input.hidden]);
    const matches = database
      .prepare(`
      SELECT kind, id FROM (
        SELECT 'entry' AS kind, e.id, bm25(document_search) AS score
        FROM document_search
          JOIN indexed_entries i ON i.id = document_search.rowid
          JOIN entries e ON e.id = i.entryId
        WHERE document_search MATCH ? AND (? IS NULL OR e.section = ?)
          AND e.id NOT IN (SELECT value FROM json_each(?))
        UNION ALL
        SELECT kind, id, bm25(session_search) AS score FROM temp.session_search
        WHERE session_search MATCH ? AND (? IS NULL OR section = ?)
      ) ORDER BY score, id LIMIT ? OFFSET ?
    `)
      .all(
        query,
        section,
        section,
        replaced,
        query,
        section,
        section,
        input.limit + 1,
        input.offset
      ) as WorkSearchMatches['matches'];
    database.exec('DELETE FROM temp.session_search');
    return { terms: words, matches: matches.slice(0, input.limit), hasMore: matches.length > input.limit };
  })();
}
