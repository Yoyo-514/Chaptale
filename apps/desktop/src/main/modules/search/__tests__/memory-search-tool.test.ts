import { Check } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';

import { estimateTextTokens } from '../../context/token-counter';
import type { MemorySearchOutput } from '../memory-search-service';
import { createMemorySearchTool, memorySearchParameters } from '../memory-search-tool';

function searchOutput(overrides: Partial<MemorySearchOutput> = {}): MemorySearchOutput {
  return {
    level: 'l2',
    attempts: [{ level: 'l2', outcome: 'success' }],
    excludedDomains: [],
    diagnostics: [],
    results: [
      {
        chunkId: 'chunk-1',
        sourcePath: '角色/林晚.md',
        domain: 'canon',
        title: '林晚',
        headingPath: ['经历'],
        body: '加入机械师公会。',
        matchedTerms: ['机械师'],
        score: 10,
        previousId: 'chunk-0',
        nextId: 'chunk-2'
      }
    ],
    ...overrides
  };
}

describe('memory_search tool', () => {
  it('declares bounded TypeBox parameters', () => {
    expect(Check(memorySearchParameters, { query: '林晚' })).toBe(true);
    expect(Check(memorySearchParameters, { query: '' })).toBe(false);
    expect(Check(memorySearchParameters, { query: '林晚', limit: 21 })).toBe(false);
    expect(Check(memorySearchParameters, { query: '林晚', maxTokens: 8001 })).toBe(false);
    expect(Check(memorySearchParameters, { query: '林晚', extra: true })).toBe(false);
  });

  it('is readonly and applies default limits and persona domains', async () => {
    const search = vi.fn(async () => searchOutput());
    const tool = createMemorySearchTool({
      service: { search },
      resolveCwd: () => '/workspace',
      allowedDomains: ['canon', 'summaries']
    });

    const result = await tool.execute({ query: ' 机械师 ' });

    expect(tool.name).toBe('memory_search');
    expect(tool.riskLevel).toBe('readonly');
    expect(search).toHaveBeenCalledWith({
      cwd: '/workspace',
      query: '机械师',
      allowedDomains: ['canon', 'summaries'],
      limit: 5
    });
    expect(JSON.parse(result.text)).toEqual(result.details);
  });

  it('fits result bodies into the requested token budget while preserving metadata', async () => {
    const search = vi.fn(async () =>
      searchOutput({
        results: [
          {
            ...searchOutput().results[0],
            body: '甲'.repeat(3_000)
          },
          {
            ...searchOutput().results[0],
            chunkId: 'chunk-2',
            sourcePath: '设定/公会.md',
            title: '机械师公会',
            body: '乙'.repeat(3_000),
            previousId: undefined,
            nextId: undefined
          }
        ]
      })
    );
    const tool = createMemorySearchTool({
      service: { search },
      resolveCwd: () => '/workspace',
      allowedDomains: ['canon']
    });

    const result = await tool.execute({ query: '机械师', maxTokens: 4_000, limit: 20 });
    const details = result.details as {
      results: Array<{ chunkId: string; content: string; truncated: boolean; sourcePath: string }>;
      truncated: boolean;
    };

    expect(details.results.map(item => item.chunkId)).toEqual(['chunk-1', 'chunk-2']);
    expect(details.results.map(item => item.sourcePath)).toEqual(['角色/林晚.md', '设定/公会.md']);
    expect(estimateTextTokens(details.results.map(item => item.content).join(''))).toBeLessThanOrEqual(4_000);
    expect(details.results[0].content).toHaveLength(3_000);
    expect(details.results[1].content).toHaveLength(1_000);
    expect(details.results[1].truncated).toBe(true);
    expect(details.truncated).toBe(true);
  });

  it('returns only safe diagnostics and never emits an absolute metadata path', async () => {
    const output = searchOutput({
      diagnostics: [
        {
          code: 'source-read-failed',
          message: 'EACCES C:/Users/name/private.md',
          sourcePath: '角色/坏文件.md',
          role: 'characters'
        },
        {
          code: 'secret-C:/Users/name/private.md',
          message: 'provider supplied code'
        }
      ],
      results: [{ ...searchOutput().results[0], sourcePath: '角色/../../private.md' }]
    });
    const tool = createMemorySearchTool({
      service: { search: vi.fn(async () => output) },
      resolveCwd: () => '/workspace',
      allowedDomains: ['canon']
    });

    const result = await tool.execute({ query: '机械师' });

    expect(result.text).not.toContain('C:/Users');
    expect(result.details).toMatchObject({
      diagnostics: [
        { code: 'source-read-failed', sourcePath: '角色/坏文件.md', role: 'characters' },
        { code: 'search-diagnostic' }
      ],
      results: [{ sourcePath: '[invalid-path]' }]
    });
  });

  it('forwards cancellation to the retrieval service', async () => {
    const search = vi.fn(async () => searchOutput());
    const tool = createMemorySearchTool({
      service: { search },
      resolveCwd: () => '/workspace',
      allowedDomains: ['canon']
    });
    const controller = new AbortController();

    await tool.execute({ query: '机械师' }, controller.signal);

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
