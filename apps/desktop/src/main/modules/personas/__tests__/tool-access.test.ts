import { describe, expect, it } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { resolveAllowedPersonaTools } from '../tool-access';

function persona(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'persona',
    name: '角色',
    type: 'plan',
    execution: 'task',
    body: '角色提示词',
    source: 'builtin',
    tools: [],
    ...overrides
  };
}

describe('resolveAllowedPersonaTools', () => {
  it('rejects unknown tools and bash at the schema policy boundary', () => {
    expect(resolveAllowedPersonaTools(persona({ tools: ['read', 'web_search', 'bash', 'unknown_tool'] }))).toEqual([
      'read',
      'web_search'
    ]);
  });

  it('prevents review personas from bypassing memory domains with generic file tools', () => {
    expect(
      resolveAllowedPersonaTools(
        persona({ type: 'review', tools: ['read', 'grep', 'find', 'ls', 'memory_search', 'web_search'] })
      )
    ).toEqual(['memory_search']);
  });

  it('keeps draft and rewrite personas on Context Pack input only', () => {
    expect(resolveAllowedPersonaTools(persona({ type: 'draft', tools: ['read', 'memory_search'] }))).toEqual([]);
    expect(resolveAllowedPersonaTools(persona({ type: 'rewrite', tools: ['read', 'memory_search'] }))).toEqual([]);
  });

  it('does not allow one-shot task personas to delegate or write durable memory', () => {
    expect(
      resolveAllowedPersonaTools(
        persona({ tools: ['delegate', 'todo_write', 'memory_save', 'memory_propose', 'read', 'memory_search'] })
      )
    ).toEqual(['read', 'memory_search']);
  });
});
