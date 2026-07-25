import { createHash } from 'node:crypto';
import path from 'node:path';

import type { FrontmatterParser } from '../frontmatter/types';
import { toWorkspaceSessionDirName } from '../settings/workspace-session-directory';
import { waitForSearch } from './abort';
import { IndexCacheStore, type IndexCacheEnvelope, type IndexCachePort } from './cache-store';
import { createSearchTokenizer, type SearchTokenizerResult } from './jieba-tokenizer';
import { KeywordIndex } from './keyword-index';
import { chunkMarkdownDocument, type MarkdownChunkOptions } from './markdown-chunker';
import { buildPinyinAliases } from './pinyin-aliases';
import { discoverIndexSourceFiles, readIndexSourceDocuments } from './source-scanner';
import type { TermTokenizer } from './term-tokenizer';
import type {
  IndexChunk,
  IndexDiagnostic,
  IndexSearchOptions,
  IndexSearchResult,
  IndexSourceDocument,
  IndexSourceResolver
} from './types';

export type IndexReadyResult = {
  chunkCount: number;
  diagnostics: IndexDiagnostic[];
};

export type IndexServiceOptions = {
  resolver: IndexSourceResolver;
  parseFrontmatter: FrontmatterParser;
  cacheRoot: string;
  cacheStore?: IndexCachePort;
  chunkConfig?: MarkdownChunkOptions;
  createTokenizer?: (customTerms: readonly string[]) => Promise<SearchTokenizerResult>;
  readDocuments?: typeof readIndexSourceDocuments;
  chunkDocument?: (document: IndexSourceDocument, options?: MarkdownChunkOptions) => IndexChunk[];
};

type WorkspaceIndexState = {
  sourceIdentity: string;
  index: KeywordIndex;
  chunkCount: number;
  diagnostics: IndexDiagnostic[];
};

/** 统一协调 source、分块、分词、倒排索引与可重建缓存的 workspace 级只读检索服务。 */
export class IndexService {
  private readonly cacheStore: IndexCachePort;
  private readonly chunkConfig: Required<MarkdownChunkOptions>;
  private readonly states = new Map<string, WorkspaceIndexState>();
  private readonly inflight = new Map<string, Promise<WorkspaceIndexState>>();

  constructor(private readonly options: IndexServiceOptions) {
    this.cacheStore = options.cacheStore ?? new IndexCacheStore(options.cacheRoot);
    this.chunkConfig = {
      maxTokens: positiveInteger(options.chunkConfig?.maxTokens, 1_000),
      overlapTokens: Math.max(0, Math.floor(options.chunkConfig?.overlapTokens ?? 200))
    };
  }

  async ensureReady(cwd: string): Promise<IndexReadyResult> {
    const state = await this.ensureState(cwd);
    return { chunkCount: state.chunkCount, diagnostics: [...state.diagnostics] };
  }

  async search(cwd: string, query: string, options: IndexSearchOptions = {}): Promise<IndexSearchResult[]> {
    if (!query.trim()) return [];
    const state = await waitForSearch(this.ensureState(cwd), options.signal);
    return state.index.search(query, options);
  }

  async getChunk(cwd: string, chunkId: string): Promise<IndexChunk | undefined> {
    return (await this.ensureState(cwd)).index.getChunk(chunkId);
  }

  /** 同一 workspace 的并发首次查询共享一个构建 promise，避免重复扫描和覆盖 cache。 */
  private ensureState(cwd: string): Promise<WorkspaceIndexState> {
    const workspacePath = path.resolve(cwd);
    const existing = this.inflight.get(workspacePath);
    if (existing) return existing;

    const promise = this.loadOrBuild(workspacePath).finally(() => {
      if (this.inflight.get(workspacePath) === promise) this.inflight.delete(workspacePath);
    });
    this.inflight.set(workspacePath, promise);
    return promise;
  }

  private async loadOrBuild(cwd: string): Promise<WorkspaceIndexState> {
    const resolved = await this.options.resolver.resolve(cwd);
    const discovered = await discoverIndexSourceFiles({ cwd, roots: resolved.roots });
    const sourceFingerprint = hashValue({
      files: discovered.fingerprint,
      roots: resolved.roots.map(root => ({
        domain: root.domain,
        role: root.role,
        path: path.relative(cwd, root.absolutePath).split(path.sep).join('/')
      }))
    });
    const workspaceKey = toWorkspaceSessionDirName(cwd);
    // sourceIdentity 只依赖 discovery 元数据，可在打开 Markdown 正文前判定内存索引是否仍有效。
    const sourceIdentity = hashValue({ workspaceKey, sourceFingerprint, chunkConfig: this.chunkConfig });
    const current = this.states.get(cwd);
    if (current?.sourceIdentity === sourceIdentity) return current;

    const diagnostics = [...resolved.diagnostics, ...discovered.diagnostics];
    let cached: IndexCacheEnvelope | undefined;
    try {
      cached = await this.cacheStore.read(cwd);
    } catch (error) {
      diagnostics.push({ code: 'cache-read-failed', message: toMessage(error) });
    }

    const cacheMatchesSource =
      cached &&
      cached.workspaceKey === workspaceKey &&
      cached.sourceFingerprint === sourceFingerprint &&
      cached.chunkConfig.maxTokens === this.chunkConfig.maxTokens &&
      cached.chunkConfig.overlapTokens === this.chunkConfig.overlapTokens &&
      cached.dictionaryFingerprint === hashValue(cached.customTerms);

    if (cached && cacheMatchesSource) {
      const cachedTokenizer = await this.createTokenizer(cached.customTerms);
      diagnostics.push(...cachedTokenizer.diagnostics);
      if (cached.tokenizerId === cachedTokenizer.tokenizer.id) {
        try {
          const state = {
            sourceIdentity,
            index: KeywordIndex.load(cached.miniSearch, cached.chunks, cachedTokenizer.tokenizer),
            chunkCount: cached.chunks.length,
            diagnostics
          };
          this.states.set(cwd, state);
          return state;
        } catch (error) {
          diagnostics.push({ code: 'cache-index-invalid', message: toMessage(error) });
        }
      }
    }

    const read = await (this.options.readDocuments ?? readIndexSourceDocuments)({
      files: discovered.files,
      parseFrontmatter: this.options.parseFrontmatter
    });
    diagnostics.push(...read.diagnostics);
    const customTerms = collectCustomTerms(read.documents);
    const dictionaryFingerprint = hashValue(customTerms);
    const tokenizerResult = await this.createTokenizer(customTerms);
    diagnostics.push(...tokenizerResult.diagnostics);
    const chunkDocument = this.options.chunkDocument ?? chunkMarkdownDocument;
    const chunks = read.documents.flatMap(document =>
      chunkDocument(document, this.chunkConfig).map(chunk =>
        enrichChunkPinyin(chunk, document, tokenizerResult.tokenizer)
      )
    );
    const index = KeywordIndex.create(chunks, tokenizerResult.tokenizer);
    const state = { sourceIdentity, index, chunkCount: chunks.length, diagnostics };
    this.states.set(cwd, state);

    // 写 cache 失败不影响当前内存索引；缓存不是事实源，也不应成为检索可用性的前置条件。
    try {
      await this.cacheStore.write(cwd, {
        schemaVersion: 1,
        workspaceKey,
        sourceFingerprint,
        dictionaryFingerprint,
        tokenizerId: tokenizerResult.tokenizer.id,
        customTerms,
        chunkConfig: this.chunkConfig,
        generatedAt: new Date().toISOString(),
        chunks,
        miniSearch: index.serialize()
      });
    } catch (error) {
      diagnostics.push({ code: 'cache-write-failed', message: toMessage(error) });
    }

    return state;
  }

  private createTokenizer(customTerms: readonly string[]): Promise<SearchTokenizerResult> {
    return (this.options.createTokenizer ?? createSearchTokenizer)(customTerms);
  }
}

/**
 * 标题/别名、分词结果和连续汉字段分别生成拼音，既支持 `linwan`，也避免只得到整段长拼音。
 */
function enrichChunkPinyin(chunk: IndexChunk, document: IndexSourceDocument, tokenizer: TermTokenizer): IndexChunk {
  const candidates = new Set([
    document.title,
    ...document.aliases,
    ...document.searchAliases,
    ...chunk.headingPath,
    ...tokenizer.tokenize(chunk.body).filter(term => /\p{Script=Han}/u.test(term)),
    ...[...chunk.body.matchAll(/\p{Script=Han}+/gu)].map(match => match[0])
  ]);
  const aliases = new Set(chunk.pinyin.split(/\s+/u).filter(Boolean));
  for (const candidate of candidates) {
    for (const alias of buildPinyinAliases(candidate, {
      surnameAtHead: document.kind === 'character',
      explicitAliases: document.searchAliases
    })) {
      aliases.add(alias);
    }
  }
  return { ...chunk, pinyin: [...aliases].join(' ') };
}

function collectCustomTerms(documents: readonly IndexSourceDocument[]): string[] {
  return [
    ...new Set(
      documents
        .flatMap(document => [document.title, ...document.aliases, ...document.searchAliases, ...document.links])
        .map(term => term.normalize('NFKC').trim())
        .filter(term => [...term].length >= 2)
    )
  ].toSorted((left, right) => left.localeCompare(right, 'zh-CN'));
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? fallback);
  return normalized > 0 ? normalized : fallback;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
