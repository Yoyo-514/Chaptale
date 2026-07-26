import type { FrontmatterParser } from '../../core/frontmatter/types';
import { throwIfSearchAborted } from './abort';
import { chunkMarkdownDocument, type MarkdownChunkOptions } from './markdown-chunker';
import type { LiteralSearchProviderPort, SearchProviderInput, SearchProviderOutput } from './memory-search-service';
import { discoverIndexSourceFiles, readIndexSourceDocuments } from './source-scanner';
import type { IndexChunk, IndexSearchResult, IndexSourceResolver } from './types';

export type LiteralSearchProviderOptions = {
  resolver: IndexSourceResolver;
  parseFrontmatter: FrontmatterParser;
  chunkConfig?: MarkdownChunkOptions;
  readFile?: (filePath: string) => Promise<string>;
};

/** 无索引、无分词依赖的最终兜底；仍复用统一 source 边界和 Markdown 分块规则。 */
export class LiteralSearchProvider implements LiteralSearchProviderPort {
  constructor(private readonly options: LiteralSearchProviderOptions) {}

  async search(input: SearchProviderInput): Promise<SearchProviderOutput> {
    throwIfSearchAborted(input.signal);
    const resolved = await this.options.resolver.resolve(input.cwd);
    const allowed = new Set(input.domains);
    const roots = resolved.roots.filter(root => allowed.has(root.domain));
    const discovered = await discoverIndexSourceFiles({ cwd: input.cwd, roots, signal: input.signal });
    throwIfSearchAborted(input.signal);
    const read = await readIndexSourceDocuments({
      files: discovered.files,
      parseFrontmatter: this.options.parseFrontmatter,
      signal: input.signal,
      ...(this.options.readFile ? { readFile: this.options.readFile } : {})
    });
    throwIfSearchAborted(input.signal);

    const query = normalize(input.query);
    const matches = read.documents
      .flatMap(document => chunkMarkdownDocument(document, this.options.chunkConfig))
      .map(chunk => ({ chunk, score: literalScore(chunk, query) }))
      .filter(match => match.score > 0)
      .toSorted(
        (left, right) =>
          right.score - left.score ||
          left.chunk.sourcePath.localeCompare(right.chunk.sourcePath, 'zh-CN') ||
          left.chunk.ordinal - right.chunk.ordinal
      )
      .slice(0, input.limit)
      .map(({ chunk, score }) => toSearchResult(chunk, input.query, score));

    return {
      results: matches,
      diagnostics: [...resolved.diagnostics, ...discovered.diagnostics, ...read.diagnostics]
    };
  }
}

function literalScore(chunk: IndexChunk, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const titleMatches = countOccurrences(normalize(chunk.title), normalizedQuery);
  const headingMatches = countOccurrences(normalize(chunk.headingPath.join(' ')), normalizedQuery);
  const bodyMatches = countOccurrences(normalize(chunk.body), normalizedQuery);
  return titleMatches * 8 + headingMatches * 4 + bodyMatches;
}

function countOccurrences(value: string, query: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= value.length - query.length) {
    const index = value.indexOf(query, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, query.length);
  }
  return count;
}

function toSearchResult(chunk: IndexChunk, query: string, score: number): IndexSearchResult {
  return {
    chunkId: chunk.id,
    sourcePath: chunk.sourcePath,
    domain: chunk.domain,
    title: chunk.title,
    ...(chunk.kind ? { kind: chunk.kind } : {}),
    headingPath: [...chunk.headingPath],
    body: chunk.body,
    matchedTerms: [query],
    score,
    ...(chunk.previousId ? { previousId: chunk.previousId } : {}),
    ...(chunk.nextId ? { nextId: chunk.nextId } : {})
  };
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}
