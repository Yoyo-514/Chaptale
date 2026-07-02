import { describe, expect, it } from 'vitest';

import { cn } from '../clsx';

describe('cn', () => {
  it('merges truthy class names', () => {
    expect(cn('base', undefined, 'active')).toBe('base active');
  });
});
