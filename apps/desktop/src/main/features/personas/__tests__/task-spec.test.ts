import { describe, expect, it } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createDefaultToolCatalog } from '../../../core/tool-protocol/catalog';
import { resolveTaskSpec } from '../task-spec';

function createPersona(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'test-reviewer',
    name: '测试审查',
    type: 'review',
    execution: 'task',
    body: '你是测试审查专员。',
    source: 'builtin',
    ...overrides
  };
}

describe('resolveTaskSpec', () => {
  const toolCatalog = createDefaultToolCatalog();

  it('derives spec with least-privilege tool default (no tools declared = no tools)', () => {
    const spec = resolveTaskSpec(createPersona(), toolCatalog);

    expect(spec).toEqual({
      personaId: 'test-reviewer',
      systemPrompt: '你是测试审查专员。',
      tools: [],
      skills: [],
      memoryReadDomains: []
    });
  });

  it('passes declared tools and model preference through', () => {
    const spec = resolveTaskSpec(
      createPersona({
        type: 'plan',
        tools: ['read', 'grep', 'memory_search', 'bash'],
        skills: ['review-checklist'],
        memory: { read: ['canon', 'notes', 'summaries'], write: [], propose: [] },
        model: { preference: 'anthropic/claude-sonnet-4-5' }
      }),
      toolCatalog
    );

    expect(spec.tools).toEqual(['read', 'grep', 'memory_search']);
    expect(spec.skills).toEqual(['review-checklist']);
    expect(spec.memoryReadDomains).toEqual(['canon', 'notes', 'summaries']);
    expect(spec.modelPreference).toBe('anthropic/claude-sonnet-4-5');
  });

  it('caps review tools to domain-aware retrieval', () => {
    const spec = resolveTaskSpec(
      createPersona({
        tools: ['read', 'grep', 'find', 'ls', 'memory_search'],
        memory: { read: ['canon', 'notes', 'summaries'], write: [], propose: [] }
      }),
      toolCatalog
    );

    expect(spec.memoryReadDomains).toEqual(['canon', 'summaries']);
    expect(spec.tools).toEqual(['memory_search']);
  });

  it('does not grant memory_search when the persona has no readable indexed domains', () => {
    const spec = resolveTaskSpec(
      createPersona({
        tools: ['memory_search'],
        memory: { read: ['notes'], write: [], propose: [] }
      }),
      toolCatalog
    );

    expect(spec.memoryReadDomains).toEqual([]);
    expect(spec.tools).toEqual([]);
  });

  it('rejects chat personas and disabled personas', () => {
    expect(() => resolveTaskSpec(createPersona({ execution: 'chat' }), toolCatalog)).toThrow(/不是 task 型/);
    expect(() => resolveTaskSpec(createPersona({ enabled: false }), toolCatalog)).toThrow(/已停用/);
  });
});
