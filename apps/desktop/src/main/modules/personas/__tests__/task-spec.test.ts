import { describe, expect, it } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

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
  it('derives spec with least-privilege tool default (no tools declared = no tools)', () => {
    const spec = resolveTaskSpec(createPersona());

    expect(spec).toEqual({
      personaId: 'test-reviewer',
      systemPrompt: '你是测试审查专员。',
      tools: []
    });
  });

  it('passes declared tools and model preference through', () => {
    const spec = resolveTaskSpec(
      createPersona({ tools: ['read', 'grep'], model: { preference: 'anthropic/claude-sonnet-4-5' } })
    );

    expect(spec.tools).toEqual(['read', 'grep']);
    expect(spec.modelPreference).toBe('anthropic/claude-sonnet-4-5');
  });

  it('rejects chat personas and disabled personas', () => {
    expect(() => resolveTaskSpec(createPersona({ execution: 'chat' }))).toThrow(/不是 task 型/);
    expect(() => resolveTaskSpec(createPersona({ enabled: false }))).toThrow(/已停用/);
  });
});
