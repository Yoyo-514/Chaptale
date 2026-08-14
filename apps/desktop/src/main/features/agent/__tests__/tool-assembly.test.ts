import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { buildChatSessionTools, buildTaskSessionTools } from '../tool-assembly';

const companion: PersonaDefinition = {
  id: 'companion',
  name: '创作伙伴',
  type: 'chat',
  execution: 'chat',
  body: '提示词',
  source: 'builtin',
  memory: { read: ['canon', 'notes', 'summaries'], write: ['notes'], propose: ['canon'] }
};

function createChatContext(overrides: Record<string, unknown> = {}) {
  return {
    todoStore: { replace: vi.fn(), read: vi.fn(async () => []) },
    getSessionId: () => 'session-1',
    sessionId: 'session-1',
    cwd: '/workspace',
    persona: companion,
    subagentPool: { run: vi.fn(), cancel: vi.fn() },
    taskRunner: { run: vi.fn() },
    personaRegistry: {
      load: vi.fn(async () => ({
        personas: [
          {
            id: 'reviewer',
            name: '审查',
            type: 'review',
            execution: 'task',
            output: 'continuity-issues',
            body: '审查',
            source: 'builtin'
          }
        ],
        diagnostics: []
      }))
    },
    memoryPendingStore: { add: vi.fn() },
    memorySearchService: { search: vi.fn() },
    ...overrides
  } as any;
}

describe('tool-registry', () => {
  it('registers the complete default chat custom-tool set in one place', async () => {
    const tools = await buildChatSessionTools(createChatContext());

    expect(tools.map(tool => tool.name)).toEqual([
      'todo_write',
      'web_search',
      'fetch_content',
      'get_search_content',
      'delegate',
      'memory_save',
      'memory_propose',
      'memory_search'
    ]);
  });

  it('uses persona memory permissions to omit unavailable memory tools', async () => {
    const search = vi.fn(async () => ({
      level: 'l2',
      attempts: [],
      excludedDomains: [],
      results: [],
      diagnostics: []
    }));
    const tools = await buildChatSessionTools(
      createChatContext({
        persona: {
          ...companion,
          memory: { read: ['summaries'], write: [], propose: [] }
        },
        memorySearchService: { search }
      })
    );

    expect(tools.map(tool => tool.name)).toEqual([
      'todo_write',
      'web_search',
      'fetch_content',
      'get_search_content',
      'delegate',
      'memory_search'
    ]);
    await tools.find(tool => tool.name === 'memory_search')!.execute({ query: '近况' });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/workspace',
        allowedDomains: ['summaries']
      })
    );
  });

  it('binds memory_propose to the chat session cwd instead of a dynamic workspace', async () => {
    const add = vi.fn(async () => ({
      id: 'p-1',
      proposalType: 'create',
      title: '新增角色：沈青',
      reason: '第 3 章出场',
      targetPath: '角色/沈青.md',
      source: 'session:session-a',
      createdAt: '2025-01-01T00:00:00.000Z',
      content: '正文'
    }));
    const tools = await buildChatSessionTools(
      createChatContext({
        cwd: '/workspace-a',
        sessionId: 'session-a',
        getSessionId: () => 'session-a',
        memoryPendingStore: { add }
      })
    );

    await tools
      .find(tool => tool.name === 'memory_propose')!
      .execute({
        proposalType: 'create',
        title: '新增角色：沈青',
        reason: '第 3 章出场',
        targetPath: '角色/沈青.md',
        content: '---\nkind: character\n---\n\n沈青。\n'
      });

    expect(add).toHaveBeenCalledWith(
      '/workspace-a',
      expect.objectContaining({
        source: 'session:session-a'
      })
    );
  });

  it('registers task custom tools and reports memory refs actually returned to the task', async () => {
    const onMemoryRead = vi.fn();
    const tools = await buildTaskSessionTools({
      spec: {
        personaId: 'planner',
        systemPrompt: '规划',
        tools: ['memory_search'],
        skills: [],
        memoryReadDomains: ['canon', 'summaries']
      },
      cwd: '/workspace',
      memorySearchService: {
        search: vi.fn(async () => ({
          level: 'l2' as const,
          attempts: [{ level: 'l2' as const, outcome: 'success' as const }],
          excludedDomains: [],
          diagnostics: [],
          results: [
            {
              chunkId: 'chunk-1',
              sourcePath: '角色/林晚.md',
              domain: 'canon' as const,
              title: '林晚',
              headingPath: [],
              body: '角色资料',
              matchedTerms: ['林晚'],
              score: 1
            }
          ]
        }))
      },
      onMemoryRead
    });

    expect(tools.map(tool => tool.name)).toEqual(['memory_search']);
    await tools[0]!.execute({ query: '林晚' }, new AbortController().signal);
    expect(onMemoryRead).toHaveBeenCalledWith(['角色/林晚.md']);
  });
});
