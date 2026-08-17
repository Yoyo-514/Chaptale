import type { FrontmatterParser } from '../../../core/frontmatter/types';
import { throwIfSearchAborted } from '../abort';
import type { LiteralSearchProviderPort, SearchProviderInput, SearchProviderOutput } from '../memory/service';
import { chunkMarkdownDocument, type MarkdownChunkOptions } from '../tokenize/markdown-chunker';
import type { IndexChunk, IndexSearchResult, IndexSourceResolver } from '../types';
import { discoverIndexSourceFiles, readIndexSourceDocuments } from './source-scanner';

export type LiteralSearchBudget = {
  maxFiles: number;
  maxBytes: number;
  timeoutMs: number;
};

export type LiteralSearchProviderOptions = {
  resolver: IndexSourceResolver;
  parseFrontmatter: FrontmatterParser;
  chunkConfig?: MarkdownChunkOptions;
  budget?: Partial<LiteralSearchBudget>;
  readFile?: (filePath: string) => Promise<string>;
};

const DEFAULT_BUDGET: LiteralSearchBudget = {
  maxFiles: 500,
  maxBytes: 20 * 1024 * 1024,
  timeoutMs: 2_000
};

/** 无索引、无分词依赖的最终兜底；仍复用统一 source 边界和 Markdown 分块规则。 */
export class LiteralSearchProvider implements LiteralSearchProviderPort {
  constructor(private readonly options: LiteralSearchProviderOptions) {}

  async search(input: SearchProviderInput): Promise<SearchProviderOutput> {
    const budget = normalizeBudget(this.options.budget);
    const timeoutController = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutController.signal]) : timeoutController.signal;
    return withTimeBudget(this.searchWithinBudget({ ...input, signal }, budget), budget.timeoutMs, timeoutController);
  }

  private async searchWithinBudget(
    input: SearchProviderInput,
    budget: LiteralSearchBudget
  ): Promise<SearchProviderOutput> {
    throwIfSearchAborted(input.signal);
    const resolved = await this.options.resolver.resolve(input.cwd);
    const allowed = new Set(input.domains);
    const roots = resolved.roots.filter(root => allowed.has(root.domain));
    const discovered = await discoverIndexSourceFiles({ cwd: input.cwd, roots, signal: input.signal });
    throwIfSearchAborted(input.signal);
    if (discovered.files.length > budget.maxFiles) {
      throw new Error(`L1 文件数预算超限：${discovered.files.length}/${budget.maxFiles}`);
    }
    const totalBytes = discovered.files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > budget.maxBytes) {
      throw new Error(`L1 字节预算超限：${totalBytes}/${budget.maxBytes}`);
    }
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

function normalizeBudget(value: Partial<LiteralSearchBudget> | undefined): LiteralSearchBudget {
  return {
    maxFiles: positiveInteger(value?.maxFiles, DEFAULT_BUDGET.maxFiles),
    maxBytes: positiveInteger(value?.maxBytes, DEFAULT_BUDGET.maxBytes),
    timeoutMs: positiveInteger(value?.timeoutMs, DEFAULT_BUDGET.timeoutMs)
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? fallback);
  return normalized > 0 ? normalized : fallback;
}

async function withTimeBudget<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutController: AbortController
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timeoutController.abort();
          reject(new Error(`L1 时间预算超限：${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
