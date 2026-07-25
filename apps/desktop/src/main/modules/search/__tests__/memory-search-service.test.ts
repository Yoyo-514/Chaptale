import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { MemorySearchService } from '../memory-search-service';
import type { IndexSearchResult, IndexSearchOptions } from '../types';

function hit(overrides: Partial<IndexSearchResult> = {}): IndexSearchResult {
  return {
    chunkId: 'chunk-1',
    sourcePath: '角色/林晚.md',
    domain: 'canon',
    title: '林晚',
    headingPath: ['经历'],
    body: '加入机械师公会。',
    matchedTerms: ['机械师'],
    score: 10,
    ...overrides
  };
}

function createIndexSearch(results: IndexSearchResult[] | Error) {
  return vi.fn(async (_cwd: string, _query: string, _options?: IndexSearchOptions) => {
    if (results instanceof Error) throw results;
    return results;
  });
}

describe('MemorySearchService', () => {
  it('uses available L3 results without calling lower levels', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => ({ results: [hit({ score: 20 })], diagnostics: [] }))
    };
    const indexSearch = createIndexSearch([hit()]);
    const literalSearch = { search: vi.fn(async () => ({ results: [hit()], diagnostics: [] })) };
    const service = new MemorySearchService({ indexSearch, literalSearch, semanticSearch });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon', 'notes'],
      requestedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l3');
    expect(result.results).toHaveLength(1);
    expect(result.attempts).toEqual([{ level: 'l3', outcome: 'success' }]);
    expect(indexSearch).not.toHaveBeenCalled();
    expect(literalSearch.search).not.toHaveBeenCalled();
  });

  it('falls through L3 empty and L2 empty to L1', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => ({ results: [], diagnostics: [] }))
    };
    const indexSearch = createIndexSearch([]);
    const literalSearch = { search: vi.fn(async () => ({ results: [hit()], diagnostics: [] })) };
    const service = new MemorySearchService({ indexSearch, literalSearch, semanticSearch });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l1');
    expect(result.attempts).toEqual([
      { level: 'l3', outcome: 'empty' },
      { level: 'l2', outcome: 'empty' },
      { level: 'l1', outcome: 'success' }
    ]);
  });

  it('falls back after provider errors without exposing raw messages', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => {
        throw new Error('secret provider key');
      })
    };
    const indexSearch = createIndexSearch(new Error('absolute C:/workspace/cache'));
    const literalSearch = { search: vi.fn(async () => ({ results: [hit()], diagnostics: [] })) };
    const service = new MemorySearchService({ indexSearch, literalSearch, semanticSearch });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l1');
    expect(result.attempts).toEqual([
      { level: 'l3', outcome: 'error', reason: 'semantic-search-failed' },
      { level: 'l2', outcome: 'error', reason: 'keyword-search-failed' },
      { level: 'l1', outcome: 'success' }
    ]);
    expect(JSON.stringify(result)).not.toContain('secret provider key');
    expect(JSON.stringify(result)).not.toContain('C:/workspace');
  });

  it('revalidates provider domains and paths before accepting results', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => ({
        results: [hit({ domain: 'canon', sourcePath: '.chaptale/memory/notes/private.md' })],
        diagnostics: []
      }))
    };
    const indexSearch = createIndexSearch([hit({ sourcePath: '角色/../../private.md' })]);
    const literalSearch = { search: vi.fn(async () => ({ results: [hit()], diagnostics: [] })) };
    const service = new MemorySearchService({ indexSearch, literalSearch, semanticSearch });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l1');
    expect(result.attempts).toEqual([
      { level: 'l3', outcome: 'empty' },
      { level: 'l2', outcome: 'empty' },
      { level: 'l1', outcome: 'success' }
    ]);
  });

  it('gives fixed memory roots precedence over overlapping configurable canon roots', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => ({
        results: [hit({ domain: 'canon', sourcePath: '.chaptale/memory/notes/private.md' })],
        diagnostics: []
      }))
    };
    const service = new MemorySearchService({
      semanticSearch,
      indexSearch: createIndexSearch([]),
      literalSearch: { search: vi.fn(async () => ({ results: [], diagnostics: [] })) },
      sourceResolver: {
        resolve: vi.fn(async cwd => ({
          diagnostics: [],
          roots: [
            {
              domain: 'canon' as const,
              role: 'characters' as const,
              absolutePath: path.resolve(cwd, '.chaptale/memory/notes')
            },
            {
              domain: 'notes' as const,
              role: 'notes' as const,
              absolutePath: path.resolve(cwd, '.chaptale/memory/notes')
            }
          ]
        }))
      }
    });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l1');
    expect(result.attempts[0]).toEqual({ level: 'l3', outcome: 'empty' });
  });

  it('intersects requested domains with persona-readable domains', async () => {
    const indexSearch = createIndexSearch([hit()]);
    const service = new MemorySearchService({
      indexSearch,
      literalSearch: { search: vi.fn(async () => ({ results: [], diagnostics: [] })) }
    });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon', 'summaries'],
      requestedDomains: ['notes', 'canon'],
      limit: 5
    });

    expect(result.excludedDomains).toEqual(['notes']);
    expect(indexSearch).toHaveBeenCalledWith('/workspace', '机械师', { domains: ['canon'], limit: 5 });
  });

  it('degrades provider AbortError when the caller did not cancel', async () => {
    const semanticSearch = {
      isAvailable: vi.fn(async () => true),
      search: vi.fn(async () => {
        throw new DOMException('provider timeout', 'AbortError');
      })
    };
    const indexSearch = createIndexSearch([hit()]);
    const service = new MemorySearchService({
      indexSearch,
      semanticSearch,
      literalSearch: { search: vi.fn(async () => ({ results: [], diagnostics: [] })) }
    });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.level).toBe('l2');
    expect(result.attempts).toEqual([
      { level: 'l3', outcome: 'error', reason: 'semantic-search-failed' },
      { level: 'l2', outcome: 'success' }
    ]);
  });

  it('stops waiting for a provider when the caller cancels', async () => {
    const controller = new AbortController();
    const service = new MemorySearchService({
      semanticSearch: {
        isAvailable: vi.fn(() => new Promise<boolean>(() => undefined)),
        search: vi.fn(async () => ({ results: [], diagnostics: [] }))
      },
      indexSearch: createIndexSearch([hit()]),
      literalSearch: { search: vi.fn(async () => ({ results: [], diagnostics: [] })) }
    });
    const pending = service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5,
      signal: controller.signal
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('treats cancellation as terminal instead of falling back', async () => {
    const controller = new AbortController();
    const indexSearch = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const literalSearch = { search: vi.fn(async () => ({ results: [hit()], diagnostics: [] })) };
    const service = new MemorySearchService({ indexSearch, literalSearch });

    await expect(
      service.search({
        cwd: '/workspace',
        query: '机械师',
        allowedDomains: ['canon'],
        limit: 5,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(literalSearch.search).not.toHaveBeenCalled();
  });

  it('returns a safe structured failure when L1 cannot run', async () => {
    const service = new MemorySearchService({
      indexSearch: createIndexSearch([]),
      literalSearch: {
        search: vi.fn(async () => {
          throw new Error('EACCES C:/private/path');
        })
      }
    });

    const result = await service.search({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon'],
      limit: 5
    });

    expect(result.failure).toEqual({
      code: 'literal-search-failed',
      message: '本地检索失败；如当前角色获准使用 grep/read，可继续检查工作区文件。'
    });
    expect(JSON.stringify(result)).not.toContain('C:/private/path');
  });
});
