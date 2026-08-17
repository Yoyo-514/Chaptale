import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';

import { estimateTextTokens, takeTextToTokenBudget } from '../../../core/context/token-counter';
import type { ToolDefinition } from '../../../core/tool-protocol/definition';
import { safeWorkspaceRelativePath } from '../path-safety';
import type { IndexDiagnostic, IndexDomain, IndexSearchResult } from '../types';
import type { MemorySearchInput, MemorySearchOutput, MemorySearchService } from './service';

const SAFE_DIAGNOSTIC_CODES = new Set([
  'cache-read-failed',
  'cache-index-invalid',
  'cache-write-failed',
  'conflict-copy-skipped',
  'source-stat-failed',
  'source-read-failed',
  'frontmatter-invalid',
  'source-directory-failed',
  'root-symlink-skipped',
  'source-outside-workspace',
  'config-invalid',
  'jieba-unavailable'
]);

const indexDomainSchema = Type.Union([Type.Literal('canon'), Type.Literal('notes'), Type.Literal('summaries')]);

export const memorySearchParameters = Type.Object(
  {
    query: Type.String({ minLength: 1, description: '要检索的名称、设定、事件或关键词' }),
    domains: Type.Optional(
      Type.Array(indexDomainSchema, {
        minItems: 1,
        uniqueItems: true,
        description: '可选检索域；省略时检索当前角色获准读取的全部域'
      })
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: '返回结果数，默认 5，最大 20' })),
    maxTokens: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 8_000, description: '结果正文总 token 预算，默认 4000，最大 8000' })
    )
  },
  { additionalProperties: false }
);

type MemorySearchPort = Pick<MemorySearchService, 'search'>;

export type MemorySearchToolContext = {
  service: MemorySearchPort;
  resolveCwd: () => Promise<string> | string;
  allowedDomains: readonly IndexDomain[];
  onRead?: (refs: readonly string[]) => void;
};

type FormattedSearchResult = {
  sourcePath: string;
  domain: IndexDomain;
  title: string;
  kind?: string;
  headingPath: string[];
  chunkId: string;
  score: number;
  matchedTerms: string[];
  content: string;
  previousId?: string;
  nextId?: string;
  truncated: boolean;
};

/** memory_search 只负责 agent 契约与预算；检索策略和降级由 MemorySearchService 统一处理。 */
export function createMemorySearchTool(
  context: MemorySearchToolContext
): ToolDefinition<typeof memorySearchParameters> {
  return {
    name: 'memory_search',
    label: '检索作品记忆',
    description:
      '在当前作品的角色、设定、大纲、伏笔、观察笔记和剧情摘要中检索相关片段。' +
      '默认使用本地关键词索引，并在可用时增强为语义检索；若当前角色有 read/grep 权限，可继续深挖。',
    riskLevel: 'readonly',
    parameters: memorySearchParameters,
    async execute(params, signal) {
      const query = params.query.trim();
      if (!query) throw new Error('query 不能为空');
      const limit = params.limit ?? 5;
      const maxTokens = params.maxTokens ?? 4_000;
      const cwd = await context.resolveCwd();
      const searchInput: MemorySearchInput = {
        cwd,
        query,
        allowedDomains: context.allowedDomains,
        limit,
        ...(params.domains ? { requestedDomains: params.domains } : {}),
        ...(signal ? { signal } : {})
      };
      const output = await context.service.search(searchInput);
      const details = formatOutput(output, limit, maxTokens);
      context.onRead?.(await collectMemoryRefs(cwd, details.results));
      return { text: JSON.stringify(details), details };
    }
  };
}

function formatOutput(output: MemorySearchOutput, limit: number, maxTokens: number) {
  let remainingTokens = maxTokens;
  let truncated = false;
  const results: FormattedSearchResult[] = [];

  for (const result of output.results.slice(0, limit)) {
    const bounded = takeTextToTokenBudget(result.body, remainingTokens);
    const resultTruncated = bounded.rest.length > 0;
    remainingTokens = Math.max(0, remainingTokens - estimateTextTokens(bounded.head));
    truncated ||= resultTruncated;
    results.push(formatResult(result, bounded.head, resultTruncated));
  }

  return {
    level: output.level,
    attempts: output.attempts,
    excludedDomains: output.excludedDomains,
    results,
    truncated,
    diagnostics: output.diagnostics.map(safeDiagnostic),
    ...(output.failure ? { failure: output.failure } : {})
  };
}

async function collectMemoryRefs(cwd: string, results: readonly FormattedSearchResult[]): Promise<string[]> {
  const sourcePaths = [...new Set(results.map(result => result.sourcePath))];
  return Promise.all(
    sourcePaths.map(async sourcePath => {
      try {
        const sourceStat = await stat(path.join(cwd, ...sourcePath.split('/')));
        return `${sourcePath}@${sourceStat.mtime.toISOString()}`;
      } catch {
        return sourcePath;
      }
    })
  );
}

function formatResult(result: IndexSearchResult, content: string, truncated: boolean): FormattedSearchResult {
  return {
    sourcePath: safeRelativePath(result.sourcePath),
    domain: result.domain,
    title: result.title,
    ...(result.kind ? { kind: result.kind } : {}),
    headingPath: [...result.headingPath],
    chunkId: result.chunkId,
    score: result.score,
    matchedTerms: [...result.matchedTerms],
    content,
    ...(result.previousId ? { previousId: result.previousId } : {}),
    ...(result.nextId ? { nextId: result.nextId } : {}),
    truncated
  };
}

function safeDiagnostic(diagnostic: IndexDiagnostic) {
  return {
    code: SAFE_DIAGNOSTIC_CODES.has(diagnostic.code) ? diagnostic.code : 'search-diagnostic',
    ...(diagnostic.sourcePath ? { sourcePath: safeWorkspaceRelativePath(diagnostic.sourcePath) } : {}),
    ...(diagnostic.role ? { role: diagnostic.role } : {})
  };
}

function safeRelativePath(sourcePath: string): string {
  return safeWorkspaceRelativePath(sourcePath);
}
