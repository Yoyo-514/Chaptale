import { describe, expect, it } from 'vitest';

import { appButtonSizes, appButtonVariants } from '../app-button.variants';

describe('app-button variants metadata', () => {
  it('lists supported semantic variants', () => {
    expect(appButtonVariants).toEqual(['primary', 'secondary', 'danger', 'outline', 'ghost', 'link']);
  });

  it('lists supported frame sizes', () => {
    expect(appButtonSizes).toEqual(['xs', 'sm', 'md', 'lg']);
  });
});
