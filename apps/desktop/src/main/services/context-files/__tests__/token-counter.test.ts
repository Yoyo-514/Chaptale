import { describe, expect, it } from 'vitest';

import { estimateTextTokens, isTextWithinTokenLimit } from '../token-counter';

describe('token-counter', () => {
  it('estimates text tokens with the same chars / 4 heuristic as pi-coding-agent', () => {
    expect(estimateTextTokens('12345678')).toBe(2);
    expect(estimateTextTokens('12345')).toBe(2);
    expect(estimateTextTokens('')).toBe(0);
  });

  it('checks inclusive token limits', () => {
    expect(isTextWithinTokenLimit('12345678', 2)).toBe(true);
    expect(isTextWithinTokenLimit('123456789', 2)).toBe(false);
  });
});
