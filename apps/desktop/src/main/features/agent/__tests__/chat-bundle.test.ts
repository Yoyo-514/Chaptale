import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createDefaultToolCatalog } from '../../../core/tool-protocol/catalog';
import { createChatRuntimeBundle } from '../chat-bundle';

const companion: PersonaDefinition = {
  id: 'companion',
  name: '创作伙伴',
  type: 'chat',
  execution: 'chat',
  body: '提示词',
  source: 'builtin'
};

function createBundle(persona: PersonaDefinition | null = companion) {
  return createChatRuntimeBundle({
    personaRegistry: {
      get: vi.fn(async () => persona),
      load: vi.fn(async () => ({ personas: [], diagnostics: [] }))
    },
    taskRunner: { run: vi.fn() },
    toolCatalog: createDefaultToolCatalog(),
    todoStore: { replace: vi.fn(), read: vi.fn(async () => []) },
    subagentPool: { run: vi.fn(), cancel: vi.fn() },
    memoryPendingStore: { add: vi.fn() },
    memorySearchService: { search: vi.fn() },
    webToolsSettingsStore: { read: vi.fn() },
    modelService: {
      listModels: vi.fn(async () => ({ defaultModel: { provider: 'prov', modelId: 'model-1' } })),
      runtime: { resolveModel: vi.fn(async () => ({ model: {} })) }
    }
  } as never);
}

describe('chat-bundle 工具装配', () => {
  it('默认白名单同时挂载文件六工具与注册工具（回归：文件工具曾被错误过滤为空）', async () => {
    const bundle = createBundle();
    const { tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    const names = tools.map(tool => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['read', 'grep', 'find', 'ls', 'write', 'edit', 'todo_write', 'delegate', 'memory_search'])
    );
    expect(names).toHaveLength(14);
  });

  it('显式 tools 白名单对注册工具与文件工具统一收窄', async () => {
    const bundle = createBundle({ ...companion, tools: ['read', 'memory_search'] });
    const { tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    expect(tools.map(tool => tool.name).toSorted()).toEqual(['memory_search', 'read']);
  });
});
