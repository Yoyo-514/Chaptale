import { describe, expect, it } from 'vitest';

import { buttonVariants } from '../button.variants';

describe('buttonVariants', () => {
  it('returns default button classes', () => {
    const classes = buttonVariants();

    expect(classes).toContain('inline-flex');
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('h-9');
  });

  it('applies variant and size classes', () => {
    const classes = buttonVariants({ variant: 'outline', size: 'icon' });

    expect(classes).toContain('border');
    expect(classes).toContain('size-9');
  });
});
