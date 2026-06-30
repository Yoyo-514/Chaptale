import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('merges truthy class names', () => {
    expect(cn('base', false && 'hidden', 'active')).toBe('base active');
  });
});
