import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import type Database from 'better-sqlite3';

import type { DocumentSearchPage, Entry, Revision, SearchDocumentsInput } from '@chaptale/creation/contracts';

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

export function searchDocuments(database: Database.Database, input: SearchDocumentsInput): DocumentSearchPage {
  // 用户输入始终作为字面词项，不解释 MATCH 运算符或列选择语法。
  const query = [...new Set(terms(input.query, false))].map(word => `"${word.replaceAll('"', '""')}"`).join(' AND ');
  if (!query) return { entries: [], hasMore: false };
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
