import { Jieba } from '@node-rs/jieba';
// Node ESM 不补扩展名，而该包没有 exports 映射；带上 .js 才能解析到 dict.js。
import { dict } from '@node-rs/jieba/dict.js';
import type Database from 'better-sqlite3';

import type {
  DocumentSearchPage,
  Entry,
  EntrySnapshot,
  Revision,
  SearchDocumentsInput
} from '@chaptale/creation/contracts';

const jieba = Jieba.withDict(dict);

function terms(text: string, search: boolean): string[] {
  const words = search ? jieba.cutForSearch(text, true) : jieba.cut(text, true);
  return words.filter(word => /[\p{L}\p{N}]/u.test(word));
}

/** 只在索引首次建立时读入已有正式稿；派生索引与正文保存在同一作品库。 */
export function openSearchIndex(database: Database.Database): void {
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'document_search'").get()) return;
  database.transaction(() => {
    database.exec(`CREATE VIRTUAL TABLE document_search USING fts5(entryId UNINDEXED, title, content)`);
    const documents = database.prepare("SELECT * FROM entries WHERE kind = 'document'").all() as Revision['snapshot'][];
    for (const document of documents) indexDocument(database, document);
  })();
}

export function indexDocument(database: Database.Database, document: Revision['snapshot']): void {
  if (document.content === null) return;
  database.prepare('DELETE FROM document_search WHERE entryId = ?').run(document.id);
  database
    .prepare('INSERT INTO document_search (entryId, title, content) VALUES (?, ?, ?)')
    .run(document.id, terms(document.title, true).join(' '), terms(document.content, true).join(' '));
}

export function searchDocuments(
  database: Database.Database,
  input: SearchDocumentsInput,
  candidates: readonly EntrySnapshot[] = []
): DocumentSearchPage {
  // 用户输入始终作为字面词项，不解释 MATCH 运算符或列选择语法。
  const query = [...new Set(terms(input.query, false))].map(word => `"${word.replaceAll('"', '""')}"`).join(' AND ');
  if (!query) return { entries: [], hasMore: false };
  if (candidates.length) return searchWithCandidates(database, input, query, candidates);
  const entries = database
    .prepare(`
    SELECT e.id, e.parentId, e.section, e.kind, e.title, e.position, e.format,
      e.wordCount, e.revisionId, e.createdAt, e.updatedAt
    FROM document_search JOIN entries e ON e.id = document_search.entryId
    WHERE document_search MATCH ? AND (? IS NULL OR e.section = ?)
    ORDER BY bm25(document_search), e.id LIMIT ? OFFSET ?
  `)
    .all(query, input.section ?? null, input.section ?? null, input.limit + 1, input.offset) as Entry[];
  return { entries: entries.slice(0, input.limit), hasMore: entries.length > input.limit };
}

/** 会话改稿仅进入连接内的临时索引，检索结束即清空，不污染正式索引。 */
function searchWithCandidates(
  database: Database.Database,
  input: SearchDocumentsInput,
  query: string,
  candidates: readonly EntrySnapshot[]
): DocumentSearchPage {
  return database.transaction(() => {
    database.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS temp.review_search USING fts5(entryId UNINDEXED, section UNINDEXED, title, content)'
    );
    database.exec('DELETE FROM temp.review_search');
    const insert = database.prepare(
      'INSERT INTO temp.review_search (entryId, section, title, content) VALUES (?, ?, ?, ?)'
    );
    const metadata = new Map<string, Entry>();
    for (const candidate of candidates) {
      if (candidate.content === null) continue;
      const { content, ...entry } = candidate;
      metadata.set(entry.id, entry);
      insert.run(entry.id, entry.section, terms(entry.title, true).join(' '), terms(content, true).join(' '));
    }
    const section = input.section ?? null;
    const matches = database
      .prepare(`
      SELECT entryId, score FROM (
        SELECT document_search.entryId, bm25(document_search) AS score
        FROM document_search JOIN entries e ON e.id = document_search.entryId
        WHERE document_search MATCH ? AND (? IS NULL OR e.section = ?)
          AND NOT EXISTS (SELECT 1 FROM temp.review_search WHERE entryId = e.id)
        UNION ALL
        SELECT entryId, bm25(review_search) AS score FROM temp.review_search
        WHERE review_search MATCH ? AND (? IS NULL OR section = ?)
      ) ORDER BY score, entryId LIMIT ? OFFSET ?
    `)
      .all(query, section, section, query, section, section, input.limit + 1, input.offset) as {
      entryId: string;
      score: number;
    }[];
    const read = database.prepare(
      'SELECT id, parentId, section, kind, title, position, format, wordCount, revisionId, createdAt, updatedAt FROM entries WHERE id = ?'
    );
    const entries = matches
      .slice(0, input.limit)
      .map(match => metadata.get(match.entryId) ?? (read.get(match.entryId) as Entry));
    database.exec('DELETE FROM temp.review_search');
    return { entries, hasMore: matches.length > input.limit };
  })();
}
