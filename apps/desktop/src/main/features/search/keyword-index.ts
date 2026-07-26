import MiniSearch, { type Options as MiniSearchOptions } from 'minisearch';

import { normalizeSearchText, type TermTokenizer } from './term-tokenizer';
import type { IndexChunk, IndexDomain, IndexSearchOptions, IndexSearchResult } from './types';

type SearchDocument = {
  id: string;
  title: string;
  heading: string;
  body: string;
  pinyin: string;
  domain: IndexDomain;
};

const STORE_FIELDS = ['domain'];
const INDEX_FIELDS = ['title', 'heading', 'body', 'pinyin'];

/** MiniSearch 的领域封装：统一字段权重、稳定排序，并阻止序列化细节泄漏到调用方。 */
export class KeywordIndex {
  private readonly chunks = new Map<string, IndexChunk>();

  private constructor(
    private readonly miniSearch: MiniSearch<SearchDocument>,
    chunks: readonly IndexChunk[]
  ) {
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }

  static create(chunks: readonly IndexChunk[], tokenizer: TermTokenizer): KeywordIndex {
    const miniSearch = new MiniSearch<SearchDocument>(createOptions(tokenizer));
    miniSearch.addAll(chunks.map(toSearchDocument));
    return new KeywordIndex(miniSearch, chunks);
  }

  static load(serialized: unknown, chunks: readonly IndexChunk[], tokenizer: TermTokenizer): KeywordIndex {
    // MiniSearch 不序列化函数；恢复时必须重新注入与 manifest 匹配的 tokenizer。
    const miniSearch = MiniSearch.loadJSON<SearchDocument>(JSON.stringify(serialized), createOptions(tokenizer));
    return new KeywordIndex(miniSearch, chunks);
  }

  search(query: string, options: IndexSearchOptions = {}): IndexSearchResult[] {
    const domains = options.domains?.length ? new Set(options.domains) : undefined;
    const limit = Math.max(1, Math.floor(options.limit ?? 20));
    const results = this.miniSearch.search(query, {
      boost: { title: 4, heading: 2.5, body: 1, pinyin: 0.65 },
      combineWith: 'OR',
      prefix: false,
      fuzzy: false,
      ...(domains ? { filter: result => domains.has(result.domain as IndexDomain) } : {})
    });

    const mapped: IndexSearchResult[] = [];
    for (const result of results) {
      const chunk = this.chunks.get(String(result.id));
      // cache 中索引与 chunk 表不一致时丢弃孤儿结果，调用方仍可使用其余命中。
      if (!chunk) continue;
      const mappedResult: IndexSearchResult = {
        chunkId: chunk.id,
        sourcePath: chunk.sourcePath,
        domain: chunk.domain,
        title: chunk.title,
        headingPath: [...chunk.headingPath],
        body: chunk.body,
        matchedTerms: [...result.terms],
        score: result.score
      };
      if (chunk.kind) mappedResult.kind = chunk.kind;
      if (chunk.previousId) mappedResult.previousId = chunk.previousId;
      if (chunk.nextId) mappedResult.nextId = chunk.nextId;
      mapped.push(mappedResult);
    }

    // score 相同则回落到稳定路径/序号，保证缓存重建前后顺序可复现。
    return mapped
      .toSorted(
        (left, right) =>
          right.score - left.score ||
          left.sourcePath.localeCompare(right.sourcePath, 'zh-CN') ||
          (this.chunks.get(left.chunkId)?.ordinal ?? 0) - (this.chunks.get(right.chunkId)?.ordinal ?? 0)
      )
      .slice(0, limit);
  }

  getChunk(chunkId: string): IndexChunk | undefined {
    const chunk = this.chunks.get(chunkId);
    return chunk ? { ...chunk, headingPath: [...chunk.headingPath] } : undefined;
  }

  serialize(): unknown {
    return this.miniSearch.toJSON();
  }
}

function createOptions(tokenizer: TermTokenizer): MiniSearchOptions<SearchDocument> {
  return {
    fields: INDEX_FIELDS,
    storeFields: STORE_FIELDS,
    idField: 'id',
    tokenize: text => tokenizer.tokenize(text),
    processTerm: term => normalizeSearchText(term) || null
  };
}

function toSearchDocument(chunk: IndexChunk): SearchDocument {
  return {
    id: chunk.id,
    title: chunk.title,
    heading: chunk.headingPath.join(' / '),
    body: chunk.body,
    pinyin: chunk.pinyin,
    domain: chunk.domain
  };
}
