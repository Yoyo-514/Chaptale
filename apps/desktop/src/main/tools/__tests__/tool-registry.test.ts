import { describe, expect, it } from 'vitest';

import { getEnabledToolNames } from '../tool-registry';

describe('tool-registry', () => {
  it('enables pi file tools without enabling bash', () => {
    expect(getEnabledToolNames()).toEqual(
      expect.arrayContaining(['read', 'grep', 'find', 'ls', 'write', 'edit', 'web_search'])
    );
    expect(getEnabledToolNames()).not.toContain('bash');
  });
});
