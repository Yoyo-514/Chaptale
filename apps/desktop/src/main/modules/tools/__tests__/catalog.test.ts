import { describe, expect, it } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createDefaultToolCatalog } from '../catalog';

const basePersona = {
  id: 'companion',
  name: 'Companion',
  type: 'chat',
  execution: 'chat',
  body: 'body',
  source: 'builtin'
} as const satisfies PersonaDefinition;

describe('ToolCatalog', () => {
  it('未声明 tools 的 chat persona 使用默认全集且不含 bash', () => {
    const catalog = createDefaultToolCatalog();
    const selected = catalog.selectSessionTools({ ...basePersona });

    expect(selected.piToolNames).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'write',
      'edit',
      'web_search',
      'fetch_content',
      'get_search_content'
    ]);
    expect(selected.customToolNames).toEqual([
      'todo_write',
      'delegate',
      'memory_save',
      'memory_propose',
      'memory_search'
    ]);
    expect(catalog.entries().map(entry => entry.name)).not.toContain('bash');
  });

  it('显式 tools 同时收窄 pi 与 custom 工具并剔除未登记工具', () => {
    const catalog = createDefaultToolCatalog();

    expect(catalog.selectSessionTools({ ...basePersona, tools: ['read', 'memory_search', 'bash'] })).toEqual({
      piToolNames: ['read'],
      customToolNames: ['memory_search']
    });
  });

  it('review/task/draft/rewrite 的收窄规则集中在同一处', () => {
    const catalog = createDefaultToolCatalog();

    expect(catalog.resolveAllowed({ ...basePersona, type: 'review', tools: ['read', 'memory_search'] })).toEqual([
      'memory_search'
    ]);
    expect(
      catalog.resolveAllowed({
        ...basePersona,
        execution: 'task',
        tools: ['memory_search', 'delegate', 'todo_write', 'read']
      })
    ).toEqual(['read', 'memory_search']);
    expect(catalog.resolveAllowed({ ...basePersona, type: 'draft', tools: ['read'] })).toEqual([]);
    expect(catalog.resolveAllowed({ ...basePersona, type: 'rewrite', tools: ['read'] })).toEqual([]);
  });

  it('未声明 tools 的 task persona 为纯分析零工具，不回落 chat 默认全集', () => {
    const catalog = createDefaultToolCatalog();

    expect(catalog.resolveAllowed({ ...basePersona, execution: 'task' })).toEqual([]);
    expect(catalog.selectSessionTools({ ...basePersona, execution: 'task' }, 'task')).toEqual({
      piToolNames: [],
      customToolNames: []
    });
  });

  it('task scope 排除仅限 chat 的工具', () => {
    const catalog = createDefaultToolCatalog();

    expect(
      catalog.selectSessionTools({ ...basePersona, execution: 'task', tools: ['read', 'memory_search'] }, 'task')
    ).toEqual({
      piToolNames: ['read'],
      customToolNames: ['memory_search']
    });
  });
});
