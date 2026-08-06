import { describe, expect, it } from 'vitest';

import { appButtonSizes, appButtonVariants } from '../constants';

describe('app-button variants metadata', () => {
  it('exposes non-empty variant and size lists without duplicates', () => {
    expect(appButtonVariants.length).toBeGreaterThan(0);
    expect(new Set(appButtonVariants).size).toBe(appButtonVariants.length);
    expect(appButtonSizes.length).toBeGreaterThan(0);
    expect(new Set(appButtonSizes).size).toBe(appButtonSizes.length);
  });

  it('keeps the default variant and size available', () => {
    expect(appButtonVariants).toContain('primary');
    expect(appButtonSizes).toContain('md');
  });
});
