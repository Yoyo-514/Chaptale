import path from 'node:path';

import type {
  AttachedFileSearchInput,
  AttachedFileSearchPort,
  AttachedFileSearchSnippet
} from '../../core/context/attached-file-search-port';
import { estimateTextTokens, takeTextTailToTokenBudget, takeTextToTokenBudget } from '../../core/context/token-counter';
import { KeywordIndex } from './index/keyword-index';
import { chunkMarkdownDocument } from './tokenize/markdown-chunker';
import { IntlSegmenterTermTokenizer } from './tokenize/term';
import type { IndexChunk, IndexSourceDocument } from './types';

const QUERY_TOKENS = 256;
const CHUNK_TOKENS = 800;
const CHUNK_OVERLAP = 100;
const RESULT_LIMIT = 8;
const INDEX_MAX_BYTES = 4 * 1024 * 1024;
const TERM_LIMIT = 16;
const HITS_PER_TERM = 3;
const HIT_PREFIX_TOKENS = 200;
const HIT_BODY_TOKENS = 800;

/** 小附件建短生命周期关键词索引；大附件只截取命中窗口，避免阻塞 Main。 */
export class AttachedFileSearchService implements AttachedFileSearchPort {
  async search(input: AttachedFileSearchInput) {
    const { signal, maxTokens } = input;
    signal?.throwIfAborted();
    const body = input.text;
    if (!body.trim() || maxTokens <= 0) return [];

    const query = takeTextToTokenBudget(input.query.trim(), QUERY_TOKENS).head;
    if (Buffer.byteLength(body, 'utf8') > INDEX_MAX_BYTES) {
      return searchLargeText(body, query, maxTokens, signal);
    }

    const chunks = chunkMarkdownDocument(toSearchDoc(input.sourcePath, body), {
      maxTokens: CHUNK_TOKENS,
      overlapTokens: CHUNK_OVERLAP
    });
    signal?.throwIfAborted();
    if (!chunks.length) return [];

    const limit = calcResultLimit(maxTokens);
    const matched = query ? findChunks(chunks, query, limit) : chunks.slice(0, limit);
    signal?.throwIfAborted();
    return fitSnippets((matched.length ? matched : chunks.slice(0, 1)).map(toSnippet), maxTokens);
  }
}

function searchLargeText(
  body: string,
  query: string,
  maxTokens: number,
  signal?: AbortSignal
): AttachedFileSearchSnippet[] {
  if (!query) return fitSnippets([firstSnippet(body)], maxTokens);

  const terms = queryTerms(query);
  if (!terms.length) return fitSnippets([firstSnippet(body)], maxTokens);

  const offsets = findHitOffsets(body, terms, signal);
  const hits = rankHitSnippets(body, offsets, terms, calcResultLimit(maxTokens));
  signal?.throwIfAborted();
  return fitSnippets(hits.length ? hits : [firstSnippet(body)], maxTokens);
}

function queryTerms(query: string): string[] {
  return new IntlSegmenterTermTokenizer()
    .tokenize(query)
    .filter(term => [...term].length >= 2)
    .toSorted((left, right) => [...right].length - [...left].length || left.localeCompare(right, 'zh-CN'))
    .slice(0, TERM_LIMIT);
}

/** 每个词只收集少量命中；后续按窗口内的查询词覆盖度统一排序。 */
function findHitOffsets(body: string, terms: string[], signal?: AbortSignal): number[] {
  const offsets = new Set<number>();
  for (const term of terms) {
    signal?.throwIfAborted();
    const pattern = new RegExp(escapeRegex(term), 'giu');
    for (let count = 0; count < HITS_PER_TERM; count += 1) {
      const match = pattern.exec(body);
      if (!match) break;
      offsets.add(match.index);
    }
  }
  return [...offsets].toSorted((left, right) => left - right);
}

function rankHitSnippets(body: string, offsets: number[], terms: string[], limit: number): AttachedFileSearchSnippet[] {
  return offsets
    .filter((offset, index) => index === 0 || offset - offsets[index - 1]! > 200)
    .map(offset => makeHitSnippet(body, offset))
    .map(snippet => {
      const text = snippet.body.toLowerCase();
      const score = terms.reduce((total, term) => total + (text.includes(term.toLowerCase()) ? term.length : 0), 0);
      return { snippet, score };
    })
    .toSorted((left, right) => right.score - left.score || left.snippet.startOffset - right.snippet.startOffset)
    .slice(0, limit)
    .map(hit => hit.snippet);
}

function makeHitSnippet(body: string, offset: number): AttachedFileSearchSnippet {
  const from = Math.max(0, offset - 4_000);
  const prefix = takeTextTailToTokenBudget(body.slice(from, offset), HIT_PREFIX_TOKENS).tail;
  const after = takeTextToTokenBudget(body.slice(offset, offset + 12_000), HIT_BODY_TOKENS).head;
  return {
    headingPath: [],
    body: `${prefix}${after}`,
    startOffset: offset - prefix.length,
    endOffset: offset + after.length
  };
}

function firstSnippet(body: string): AttachedFileSearchSnippet {
  const text = takeTextToTokenBudget(body, HIT_BODY_TOKENS).head;
  return { headingPath: [], body: text, startOffset: 0, endOffset: text.length };
}

function toSearchDoc(sourcePath: string, body: string): IndexSourceDocument {
  return {
    sourcePath,
    // KeywordIndex 要求领域字段；临时附件索引不会把占位值暴露到端口外。
    domain: 'notes',
    role: 'notes',
    title: path.basename(sourcePath),
    aliases: [],
    searchAliases: [],
    links: [],
    body,
    size: Buffer.byteLength(body, 'utf8'),
    mtimeMs: 0
  };
}

function findChunks(chunks: IndexChunk[], query: string, limit: number): IndexChunk[] {
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const index = KeywordIndex.create(chunks, new IntlSegmenterTermTokenizer());
  return index
    .search(query, { limit })
    .map(result => byId.get(result.chunkId))
    .filter((chunk): chunk is IndexChunk => chunk !== undefined);
}

function toSnippet(chunk: IndexChunk): AttachedFileSearchSnippet {
  return {
    headingPath: [...chunk.headingPath],
    body: chunk.body,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset
  };
}

function fitSnippets(snippets: AttachedFileSearchSnippet[], maxTokens: number): AttachedFileSearchSnippet[] {
  const fitted: AttachedFileSearchSnippet[] = [];
  let tokensLeft = Math.max(0, Math.floor(maxTokens));

  for (const snippet of snippets) {
    const body = takeTextToTokenBudget(snippet.body, tokensLeft).head;
    if (!body) break;
    fitted.push({ ...snippet, body, endOffset: snippet.startOffset + body.length });
    tokensLeft -= estimateTextTokens(body);
    if (tokensLeft <= 0) break;
  }

  return fitted;
}

function calcResultLimit(maxTokens: number): number {
  return Math.min(RESULT_LIMIT, Math.max(1, Math.ceil(maxTokens / CHUNK_TOKENS)));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
