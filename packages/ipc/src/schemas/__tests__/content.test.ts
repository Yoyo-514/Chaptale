import { describe, expect, it } from 'vitest';

import { ContentDeleteValidator, ContentReadValidator } from '../../content';

const ref = {
  kind: 'skill',
  id: 'scene-helper',
  source: 'workspace',
  sourcePath: 'scene-helper/SKILL.md',
  hash: 'a'.repeat(64)
};

describe('content lifecycle contracts', () => {
  it('accepts explicit archive identities and requires a delete fingerprint', () => {
    expect(ContentReadValidator.Check([{ ref: { ...ref, archived: true } }])).toBe(true);
    expect(ContentDeleteValidator.Check([{ ref, fingerprint: 'b'.repeat(64) }])).toBe(true);
    expect(ContentDeleteValidator.Check([{ ref }])).toBe(false);
    expect(ContentDeleteValidator.Check([{ ref, fingerprint: 'stale' }])).toBe(false);
  });
  it('rejects renderer-supplied deletion paths and unknown identity fields', () => {
    expect(ContentDeleteValidator.Check([{ ref, fingerprint: 'b'.repeat(64), paths: ['../history'] }])).toBe(false);
    expect(ContentReadValidator.Check([{ ref: { ...ref, sourcePath: '../outside.md' } }])).toBe(false);
    expect(ContentReadValidator.Check([{ ref: { ...ref, archived: 'true' } }])).toBe(false);
  });
});
