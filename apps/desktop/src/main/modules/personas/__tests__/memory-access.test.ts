import { describe, expect, it } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { resolveReadableIndexDomains } from '../memory-access';

function persona(overrides: Partial<PersonaDefinition> = {}): PersonaDefinition {
  return {
    id: 'persona',
    name: '角色',
    type: 'chat',
    execution: 'chat',
    body: '角色提示词',
    source: 'builtin',
    memory: { read: ['canon', 'notes', 'summaries'], write: [], propose: [] },
    ...overrides
  };
}

describe('resolveReadableIndexDomains', () => {
  it('keeps explicitly declared indexed domains for chat personas', () => {
    expect(resolveReadableIndexDomains(persona())).toEqual(['canon', 'notes', 'summaries']);
  });

  it('hard-caps review personas so unconfirmed notes stay invisible', () => {
    expect(resolveReadableIndexDomains(persona({ type: 'review', execution: 'task' }))).toEqual(['canon', 'summaries']);
  });

  it('does not grant direct index access to draft or rewrite personas', () => {
    expect(resolveReadableIndexDomains(persona({ type: 'draft', execution: 'task' }))).toEqual([]);
    expect(resolveReadableIndexDomains(persona({ type: 'rewrite', execution: 'task' }))).toEqual([]);
  });

  it('uses least privilege when memory.read is omitted and ignores unsupported domains', () => {
    expect(resolveReadableIndexDomains(persona({ memory: undefined }))).toEqual([]);
    expect(
      resolveReadableIndexDomains(
        persona({ memory: { read: ['preferences', 'packs', 'canon'], write: [], propose: [] } })
      )
    ).toEqual(['canon']);
  });
});
