import path from 'node:path';

import { throwIfSearchAborted, waitForSearch } from './abort';
import { isSafeWorkspaceRelativePath } from './path-safety';
import { WorkspaceIndexSourceResolver } from './source-resolver';
import type { IndexDiagnostic, IndexDomain, IndexSearchOptions, IndexSearchResult, IndexSourceResolver } from './types';

const LITERAL_SEARCH_FAILURE_MESSAGE = '本地检索失败；如当前角色获准使用 grep/read，可继续检查工作区文件。';

export type SearchLevel = 'l1' | 'l2' | 'l3';
export type SearchAttempt = {
  level: SearchLevel;
  outcome: 'success' | 'empty' | 'error' | 'unavailable';
  reason?: string;
};

export type SearchProviderInput = {
  cwd: string;
  query: string;
  domains: IndexDomain[];
  limit: number;
  signal?: AbortSignal;
};

export type SearchProviderOutput = {
  results: IndexSearchResult[];
  diagnostics: IndexDiagnostic[];
};

export interface LiteralSearchProviderPort {
  search(input: SearchProviderInput): Promise<SearchProviderOutput>;
}

export interface SemanticSearchProvider {
  isAvailable(cwd: string, signal?: AbortSignal): Promise<boolean>;
  search(input: SearchProviderInput): Promise<SearchProviderOutput>;
}

export type MemorySearchInput = {
  cwd: string;
  query: string;
  allowedDomains: readonly IndexDomain[];
  requestedDomains?: readonly IndexDomain[];
  limit: number;
  signal?: AbortSignal;
};

export type MemorySearchOutput = {
  level: SearchLevel;
  attempts: SearchAttempt[];
  excludedDomains: IndexDomain[];
  results: IndexSearchResult[];
  diagnostics: IndexDiagnostic[];
  failure?: { code: 'literal-search-failed'; message: string };
};

type IndexSearchPort = (cwd: string, query: string, options?: IndexSearchOptions) => Promise<IndexSearchResult[]>;

export type MemorySearchServiceOptions = {
  indexSearch: IndexSearchPort;
  literalSearch: LiteralSearchProviderPort;
  semanticSearch?: SemanticSearchProvider;
  sourceResolver?: IndexSourceResolver;
};

type DomainRoot = { domain: IndexDomain; sourcePrefix: string };

/** 对 agent 暴露稳定的单一检索语义；各层失败只改变能力等级，不改变结果契约。 */
export class MemorySearchService {
  private readonly sourceResolver: IndexSourceResolver;

  constructor(private readonly options: MemorySearchServiceOptions) {
    this.sourceResolver = options.sourceResolver ?? new WorkspaceIndexSourceResolver();
  }

  async search(input: MemorySearchInput): Promise<MemorySearchOutput> {
    throwIfSearchAborted(input.signal);
    const allowed = new Set(input.allowedDomains);
    const requested = [...new Set(input.requestedDomains ?? input.allowedDomains)];
    const excludedDomains = requested.filter(domain => !allowed.has(domain));
    const domains = requested.filter(domain => allowed.has(domain));
    const attempts: SearchAttempt[] = [];
    const diagnostics: IndexDiagnostic[] = [];
    const providerInput: SearchProviderInput = {
      cwd: input.cwd,
      query: input.query,
      domains,
      limit: input.limit,
      ...(input.signal ? { signal: input.signal } : {})
    };

    if (domains.length === 0) {
      return {
        level: 'l2',
        attempts: [{ level: 'l2', outcome: 'empty', reason: 'no-readable-domains' }],
        excludedDomains,
        results: [],
        diagnostics
      };
    }

    let domainRoots: DomainRoot[];
    try {
      const resolved = await waitForSearch(this.sourceResolver.resolve(input.cwd), input.signal);
      domainRoots = toDomainRoots(input.cwd, resolved.roots);
    } catch (error) {
      if (isAbort(error, input.signal)) throw error;
      return sourcePolicyFailure(excludedDomains, diagnostics);
    }

    if (this.options.semanticSearch) {
      let available = false;
      try {
        available = await waitForSearch(this.options.semanticSearch.isAvailable(input.cwd, input.signal), input.signal);
      } catch (error) {
        if (isAbort(error, input.signal)) throw error;
        attempts.push({ level: 'l3', outcome: 'error', reason: 'semantic-search-failed' });
      }

      if (available) {
        try {
          const semantic = await waitForSearch(this.options.semanticSearch.search(providerInput), input.signal);
          diagnostics.push(...semantic.diagnostics);
          const results = validateResults(semantic.results, domains, domainRoots);
          if (results.length > 0) {
            attempts.push({ level: 'l3', outcome: 'success' });
            return { level: 'l3', attempts, excludedDomains, results, diagnostics };
          }
          attempts.push({ level: 'l3', outcome: 'empty' });
        } catch (error) {
          if (isAbort(error, input.signal)) throw error;
          attempts.push({ level: 'l3', outcome: 'error', reason: 'semantic-search-failed' });
        }
      } else if (!attempts.some(attempt => attempt.level === 'l3')) {
        attempts.push({ level: 'l3', outcome: 'unavailable' });
      }
    }

    try {
      const keyword = await waitForSearch(
        this.options.indexSearch(input.cwd, input.query, {
          domains,
          limit: input.limit,
          ...(input.signal ? { signal: input.signal } : {})
        }),
        input.signal
      );
      const results = validateResults(keyword, domains, domainRoots);
      if (results.length > 0) {
        attempts.push({ level: 'l2', outcome: 'success' });
        return { level: 'l2', attempts, excludedDomains, results, diagnostics };
      }
      attempts.push({ level: 'l2', outcome: 'empty' });
    } catch (error) {
      if (isAbort(error, input.signal)) throw error;
      attempts.push({ level: 'l2', outcome: 'error', reason: 'keyword-search-failed' });
    }

    try {
      const literal = await waitForSearch(this.options.literalSearch.search(providerInput), input.signal);
      diagnostics.push(...literal.diagnostics);
      const results = validateResults(literal.results, domains, domainRoots);
      attempts.push({ level: 'l1', outcome: results.length > 0 ? 'success' : 'empty' });
      return { level: 'l1', attempts, excludedDomains, results, diagnostics };
    } catch (error) {
      if (isAbort(error, input.signal)) throw error;
      attempts.push({ level: 'l1', outcome: 'error', reason: 'literal-search-failed' });
      return {
        level: 'l1',
        attempts,
        excludedDomains,
        results: [],
        diagnostics,
        failure: {
          code: 'literal-search-failed',
          message: LITERAL_SEARCH_FAILURE_MESSAGE
        }
      };
    }
  }
}

function isAbort(_error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function validateResults(
  results: readonly IndexSearchResult[],
  domains: readonly IndexDomain[],
  roots: readonly DomainRoot[]
): IndexSearchResult[] {
  const allowed = new Set(domains);
  return results.filter(
    result =>
      allowed.has(result.domain) &&
      isSafeWorkspaceRelativePath(result.sourcePath) &&
      resolveSourceDomain(result.sourcePath, roots) === result.domain
  );
}

function toDomainRoots(cwd: string, roots: Awaited<ReturnType<IndexSourceResolver['resolve']>>['roots']): DomainRoot[] {
  const workspacePath = path.resolve(cwd);
  return roots.flatMap(root => {
    const sourcePrefix = path.relative(workspacePath, path.resolve(root.absolutePath)).split(path.sep).join('/');
    return isSafeWorkspaceRelativePath(sourcePrefix) ? [{ domain: root.domain, sourcePrefix }] : [];
  });
}

function isPathInsidePrefix(sourcePath: string, sourcePrefix: string): boolean {
  return sourcePath === sourcePrefix || sourcePath.startsWith(`${sourcePrefix}/`);
}

function resolveSourceDomain(sourcePath: string, roots: readonly DomainRoot[]): IndexDomain | undefined {
  const matches = roots.filter(root => isPathInsidePrefix(sourcePath, root.sourcePrefix));
  // notes/summaries 是固定的受控 memory 根；即使用户把 canon 配到其祖先或子目录，也不能覆盖其域。
  const memoryMatches = matches.filter(root => root.domain === 'notes' || root.domain === 'summaries');
  const candidates = memoryMatches.length > 0 ? memoryMatches : matches;
  if (candidates.length === 0) return undefined;

  const longestPrefix = Math.max(...candidates.map(root => root.sourcePrefix.length));
  const domains = new Set(
    candidates.filter(root => root.sourcePrefix.length === longestPrefix).map(root => root.domain)
  );
  return domains.size === 1 ? domains.values().next().value : undefined;
}

function sourcePolicyFailure(excludedDomains: IndexDomain[], diagnostics: IndexDiagnostic[]): MemorySearchOutput {
  return {
    level: 'l1',
    attempts: [{ level: 'l1', outcome: 'error', reason: 'source-policy-failed' }],
    excludedDomains,
    results: [],
    diagnostics,
    failure: {
      code: 'literal-search-failed',
      message: LITERAL_SEARCH_FAILURE_MESSAGE
    }
  };
}
